import type { AccessContext } from "@/domain/access"
import { contentAnalysisSchema, createContentSampleSchema, structureCandidateSchema } from "@/domain/content-brain-schemas"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getContentBrainServices, type ContentBrainServices } from "@/services/content-brain-service-factory"
import { contentBrainFailure, contentBrainNotFound, platformHttpContext } from "@/services/content-brain-http"
import { requireIdempotencyKey } from "@/lib/http/idempotency-key"
import { getModelTaskService } from "@/services/model-task-service-factory"
import type { ModelTaskService } from "@/services/model-task-service"
import { z } from "zod"
import { withRequestLog } from "@/lib/observability/request-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ContentBrainDeps = ContentBrainServices & { modelTasks?: ModelTaskService }

const emptySchema = z.object({}).strict()
const analyzeJobSchema = z.object({ batchId: z.string().uuid().optional() }).strict()
const versionSchema = z.object({ expectedVersion: z.number().int().positive() }).strict()
const reasonSchema = z.object({ reason: z.string().trim().min(2).max(2_000) }).strict()
const versionReasonSchema = reasonSchema.extend({ expectedVersion: z.number().int().positive() }).strict()
const analysisDraftSchema = z.object({ expectedVersion: z.number().int().positive(), payload: contentAnalysisSchema }).strict()
const candidateDraftSchema = z.object({ expectedVersion: z.number().int().positive(), payload: structureCandidateSchema }).strict()
const sampleStatusSchema = z.enum(["draft", "analyzing", "review_required", "reviewed", "candidate_ready", "completed", "analysis_failed", "rejected"])

export async function handleContentBrain(
  request: Request,
  segments: string[],
  access: AccessContext | null,
  deps: ContentBrainDeps,
) {
  const resolved = platformHttpContext(access)
  if (resolved.response) return resolved.response
  const context = resolved.context
  try {
    if (request.method === "POST" && segments.length === 1 && segments[0] === "samples") {
      const input = createContentSampleSchema.parse(await request.json())
      return Response.json(deps.samples.createFromText(context, input), { status: 201 })
    }
    if (request.method === "POST" && segments.length === 2 && segments[0] === "samples" && segments[1] === "imports") {
      const form = await request.formData()
      const file = form.get("file")
      if (!file || typeof file === "string" || !("arrayBuffer" in file)) throw new Error("CONTENT_SAMPLE_FILE_REQUIRED")
      const rightsNote = z.string().trim().min(2).max(2_000).parse(form.get("rightsNote"))
      const result = await deps.samples.createFromFile(context, {
        filename: file.name, mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()), rightsNote,
      })
      return Response.json(result, { status: 201 })
    }
    if (request.method === "GET" && segments.length === 1 && segments[0] === "samples") {
      const rawStatus = new URL(request.url).searchParams.get("status")
      const status = rawStatus ? sampleStatusSchema.parse(rawStatus) : undefined
      return Response.json(deps.repository.listSamples(status))
    }
    if (request.method === "GET" && segments.length === 2 && segments[0] === "samples") {
      return Response.json(deps.repository.getSampleWorkspace(segments[1]))
    }
    if (request.method === "POST" && segments.length === 3 && segments[0] === "samples" && segments[2] === "analyze") {
      const input = analyzeJobSchema.parse(await request.json())
      const job = deps.analysisJobs.enqueue(context, segments[1], requireIdempotencyKey(request), input.batchId)
      deps.analysisJobs.kick()
      return Response.json(job, { status: 202 })
    }
    if (request.method === "GET" && segments.length === 1 && segments[0] === "tasks") {
      const rawLimit = new URL(request.url).searchParams.get("limit")
      const limit = rawLimit ? z.coerce.number().int().min(1).max(500).parse(rawLimit) : 100
      return Response.json(deps.analysisJobs.list(context, limit))
    }
    if (request.method === "GET" && segments.length === 2 && segments[0] === "tasks") {
      return Response.json(deps.analysisJobs.get(context, segments[1]))
    }
    if (request.method === "POST" && segments.length === 3 && segments[0] === "tasks" && segments[2] === "retry") {
      emptySchema.parse(await request.json())
      const job = deps.analysisJobs.retry(context, segments[1], requireIdempotencyKey(request))
      deps.analysisJobs.kick()
      return Response.json(job, { status: 202 })
    }
    if (request.method === "PUT" && segments.length === 2 && segments[0] === "analyses") {
      const input = analysisDraftSchema.parse(await request.json())
      return Response.json(deps.analysis.saveDraft(context, segments[1], input))
    }
    if (request.method === "POST" && segments.length === 3 && segments[0] === "analyses" && segments[2] === "approve") {
      const input = analysisDraftSchema.parse(await request.json())
      const result = deps.modelTasks ? await deps.modelTasks.run({
        scopeType: "platform", actorUserId: context.userId, operation: "content_brain.structure_candidate",
        idempotencyKey: requireIdempotencyKey(request), signal: request.signal,
      }, () => deps.analysis.approveAndPropose(context, segments[1], input),
      () => deps.analysis.findApprovedResult(segments[1]))
        : await deps.analysis.approveAndPropose(context, segments[1], input)
      return Response.json(result)
    }
    if (request.method === "POST" && segments.length === 3 && segments[0] === "analyses" && segments[2] === "reject") {
      const input = versionReasonSchema.parse(await request.json())
      return Response.json(deps.analysis.rejectAnalysis(context, segments[1], input))
    }
    if (request.method === "PUT" && segments.length === 2 && segments[0] === "candidates") {
      const input = candidateDraftSchema.parse(await request.json())
      return Response.json(deps.workflow.reviewCandidate(context, segments[1], input))
    }
    if (request.method === "POST" && segments.length === 3 && segments[0] === "candidates" && segments[2] === "preview") {
      const input = versionSchema.parse(await request.json())
      const result = deps.modelTasks ? await deps.modelTasks.run({
        scopeType: "platform", actorUserId: context.userId, operation: "content_brain.structure_preview",
        idempotencyKey: requireIdempotencyKey(request), signal: request.signal,
      }, () => deps.workflow.previewCandidate(context, segments[1], input.expectedVersion),
      () => deps.workflow.getLatestPreview(context, segments[1], input.expectedVersion))
        : await deps.workflow.previewCandidate(context, segments[1], input.expectedVersion)
      return Response.json(result)
    }
    if (request.method === "POST" && segments.length === 3 && segments[0] === "candidates" && segments[2] === "reject") {
      const input = versionReasonSchema.parse(await request.json())
      return Response.json(deps.workflow.rejectCandidate(context, segments[1], input))
    }
    if (request.method === "POST" && segments.length === 3 && segments[0] === "candidates" && segments[2] === "activate") {
      const input = versionReasonSchema.parse(await request.json())
      return Response.json(deps.workflow.activateCandidate(context, segments[1], input))
    }
    if (request.method === "POST" && segments.length === 3 && segments[0] === "versions" && segments[2] === "deactivate") {
      const input = reasonSchema.parse(await request.json())
      return Response.json(deps.workflow.deactivateVersion(context, segments[1], input.reason))
    }
    if (request.method === "POST" && segments.length === 3 && segments[0] === "versions" && segments[2] === "rollback") {
      const input = reasonSchema.parse(await request.json())
      return Response.json(deps.workflow.rollbackVersion(context, segments[1], input.reason))
    }
    if (request.method === "POST" && segments.length === 3 && segments[0] === "structures" && segments[2] === "evaluate") {
      emptySchema.parse(await request.json())
      requireIdempotencyKey(request)
      return Response.json(deps.evaluations.evaluate(segments[1]))
    }
    if (request.method === "GET" && segments.length === 1 && segments[0] === "evaluations") {
      return Response.json(deps.evaluations.listCurrent())
    }
    if (request.method === "GET" && segments.length === 2 && segments[0] === "evaluations") {
      return Response.json({
        evaluation: deps.evaluations.get(segments[1]),
        evidence: deps.evaluations.evidence(segments[1]),
      })
    }
    if (request.method === "POST" && segments.length === 3 && segments[0] === "evaluations" && segments[2] === "propose") {
      emptySchema.parse(await request.json())
      const result = deps.modelTasks ? await deps.modelTasks.run({
        scopeType: "platform", actorUserId: context.userId, operation: "content_brain.structure_evolution",
        idempotencyKey: requireIdempotencyKey(request), signal: request.signal,
      }, () => deps.evolution.propose(context, segments[1])) : await deps.evolution.propose(context, segments[1])
      return Response.json(result)
    }
    if (request.method === "GET" && segments.length === 1 && segments[0] === "structures") {
      return Response.json(deps.repository.listActivePackages())
    }
    return contentBrainNotFound()
  } catch (error) {
    return contentBrainFailure(error)
  }
}

type RouteContext = { params: Promise<{ segments: string[] }> }
async function get(request: Request, route: RouteContext) {
  return handleContentBrain(request, (await route.params).segments, await resolveCurrentAccess(), getContentBrainServices())
}
async function post(request: Request, route: RouteContext) {
  return handleContentBrain(request, (await route.params).segments, await resolveCurrentAccess(), {
    ...getContentBrainServices(), modelTasks: getModelTaskService(),
  })
}
async function put(request: Request, route: RouteContext) {
  return handleContentBrain(request, (await route.params).segments, await resolveCurrentAccess(), getContentBrainServices())
}

export const GET = withRequestLog(get)
export const POST = withRequestLog(post)
export const PUT = withRequestLog(put)
