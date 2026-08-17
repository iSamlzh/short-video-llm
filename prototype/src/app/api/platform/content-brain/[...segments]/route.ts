import type { AccessContext } from "@/domain/access"
import { contentAnalysisSchema, createContentSampleSchema, structureCandidateSchema } from "@/domain/content-brain-schemas"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getContentBrainServices, type ContentBrainServices } from "@/services/content-brain-service-factory"
import { contentBrainFailure, contentBrainNotFound, platformHttpContext } from "@/services/content-brain-http"
import { z } from "zod"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ContentBrainDeps = ContentBrainServices

const emptySchema = z.object({}).strict()
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
      emptySchema.parse(await request.json())
      return Response.json(await deps.analysis.analyze(context, segments[1]))
    }
    if (request.method === "PUT" && segments.length === 2 && segments[0] === "analyses") {
      const input = analysisDraftSchema.parse(await request.json())
      return Response.json(deps.analysis.saveDraft(context, segments[1], input))
    }
    if (request.method === "POST" && segments.length === 3 && segments[0] === "analyses" && segments[2] === "approve") {
      const input = analysisDraftSchema.parse(await request.json())
      return Response.json(await deps.analysis.approveAndPropose(context, segments[1], input))
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
      return Response.json(await deps.workflow.previewCandidate(context, segments[1], input.expectedVersion))
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
    if (request.method === "GET" && segments.length === 1 && segments[0] === "structures") {
      return Response.json(deps.repository.listActivePackages())
    }
    return contentBrainNotFound()
  } catch (error) {
    return contentBrainFailure(error)
  }
}

type RouteContext = { params: Promise<{ segments: string[] }> }
export async function GET(request: Request, route: RouteContext) {
  return handleContentBrain(request, (await route.params).segments, await resolveCurrentAccess(), getContentBrainServices())
}
export async function POST(request: Request, route: RouteContext) {
  return handleContentBrain(request, (await route.params).segments, await resolveCurrentAccess(), getContentBrainServices())
}
export async function PUT(request: Request, route: RouteContext) {
  return handleContentBrain(request, (await route.params).segments, await resolveCurrentAccess(), getContentBrainServices())
}
