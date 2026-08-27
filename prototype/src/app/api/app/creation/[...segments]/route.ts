import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { NextRequest } from "next/server"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { PrototypeRepository } from "@/lib/db/repository"
import { OpenAiCompatibleAdapter } from "@/lib/llm/adapter"
import { PrototypeFixtureLlmAdapter } from "@/lib/llm/fake"
import { StructuredLlmClient } from "@/lib/llm/structured"
import { withRequestLog } from "@/lib/observability/request-log"
import { RunService } from "@/services/run-service"
import { AutoCreationOrchestrator } from "@/services/auto-creation-orchestrator"
import { CreationAppService } from "@/services/creation-app-service"
import { ContentBrainRepository } from "@/lib/db/content-brain-repository"
import { PlatformTemplateRetriever } from "@/services/platform-template-retriever"
import { z } from "zod"
import { scriptRevisionParagraphsSchema } from "@/domain/schemas"
import { scriptSegmentsSchema } from "@/domain/creation-contracts"
import { buildScriptDocx } from "@/services/script-export-service"
import { modelTaskError } from "@/lib/llm/model-task-error"
import { deprecationHeaders, requireIdempotencyKey } from "@/lib/http/idempotency-key"
import { getModelTaskService } from "@/services/model-task-service-factory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let singleton: CreationAppService | undefined
const draftMutationSchema = z.object({
  expectedRevision: z.number().int().positive(),
  segments: scriptSegmentsSchema.optional(),
  paragraphs: scriptRevisionParagraphsSchema.optional(),
}).refine((input) => Boolean(input.segments || input.paragraphs), { message: "结构化段落不能为空" })
const nextRoundSchema = z.object({
  sourceReviewId: z.string().trim().min(1),
  expectedMemoryVersion: z.number().int().positive(),
}).strict()
const topicScriptSchema = z.object({
  runId: z.string().trim().min(1),
  topicId: z.string().trim().min(1),
  intent: z.enum(["initial", "change_topic", "change_expression"]).optional(),
  fromRunId: z.string().trim().min(1).optional(),
}).strict()
const topicPoolSchema = z.object({
  intent: z.enum(["initial", "change_topic", "change_expression"]).optional(),
  fromRunId: z.string().trim().min(1).optional(),
}).strict()

function service() {
  if (singleton) return singleton
  const path = resolve(/* turbopackIgnore: true */ process.cwd(), process.env.PROTOTYPE_DB_PATH ?? ".data/prototype.sqlite")
  mkdirSync(dirname(path), { recursive: true })
  const repository = new PrototypeRepository(path)
  const fixtureAllowed = process.env.PROTOTYPE_TEST_MODE === "true" && process.env.PLAYWRIGHT_TEST_MODE === "true"
  const llm = new StructuredLlmClient(fixtureAllowed ? new PrototypeFixtureLlmAdapter() : new OpenAiCompatibleAdapter())
  const retriever = new PlatformTemplateRetriever(new ContentBrainRepository(getAppDatabase()))
  const runs = new RunService(repository, llm, (query) => retriever.retrieve(query))
  singleton = new CreationAppService(getAppDatabase(), runs, new AutoCreationOrchestrator(runs))
  return singleton
}

async function draftMutationInput(request: NextRequest) {
  const parsed = draftMutationSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    throw Object.assign(new Error("SCRIPT_SEGMENTS_INVALID"), { code: "SCRIPT_SEGMENTS_INVALID" })
  }
  return parsed.data
}

const modelErrorStatuses: Record<string, number> = {
  MODEL_RATE_LIMITED: 429,
  LLM_TIMEOUT: 504,
  MODEL_SCHEMA_INVALID: 502,
  MODEL_CONNECTION_FAILED: 503,
  MODEL_SERVICE_UNAVAILABLE: 503,
  MODEL_STREAM_INVALID: 502,
}

export function creationErrorResponse(error: unknown) {
  const value = error as { code?: string; message?: string; retryable?: boolean; status?: number }
  const code = value.code ?? value.message ?? "INTERNAL_ERROR"
  const status = value.status ?? modelErrorStatuses[code] ?? (code === "RUN_NOT_FOUND" ? 404
    : code.includes("FORBIDDEN") ? 403
      : ["MEMORY_VERSION_STALE", "MEMORY_REVIEW_MISMATCH", "REVIEW_NOT_CONFIRMED"].includes(code) ? 409 : 400)
  return Response.json({ errorCode: code, message: value.message ?? "操作失败", retryable: Boolean(value.retryable) }, { status })
}

async function dispatch(request: NextRequest, segments: string[]) {
  const access = await resolveCurrentAccess()
  if (!access) return Response.json({ errorCode: "UNAUTHENTICATED", message: "请先登录" }, { status: 401 })
  if (access.audience !== "tenant") return Response.json({ errorCode: "TENANT_AUDIENCE_REQUIRED" }, { status: 403 })
  try {
    if (request.method === "GET" && segments.join("/") === "current") {
      const current = service().getCurrent(access)
      return current ? Response.json(current) : new Response(null, { status: 204 })
    }
    if (request.method === "POST" && segments.join("/") === "auto") {
      const body = await request.json().catch(() => ({})) as { intent?: "initial" | "change_topic" | "change_expression"; fromRunId?: string }
      const result = await getModelTaskService().run({
        tenantId: access.tenantId,
        actorUserId: access.userId,
        operation: `creation.auto.${body.intent ?? "initial"}`,
        idempotencyKey: requireIdempotencyKey(request),
        signal: request.signal,
      }, () => service().create(access, body), (runId) => {
        if (!runId) throw modelTaskError("MODEL_TASK_RESULT_NOT_FOUND", 409, false)
        return service().getRun(access, runId)
      })
      return Response.json(result, {
        status: 201,
        headers: deprecationHeaders("/api/app/creation/topics + /api/app/creation/scripts"),
      })
    }
    if (request.method === "POST" && segments.join("/") === "topics") {
      const input = topicPoolSchema.parse(await request.json().catch(() => ({})))
      const result = await getModelTaskService().run({
        tenantId: access.tenantId,
        actorUserId: access.userId,
        operation: `creation.topics.${input.intent ?? "initial"}`,
        idempotencyKey: requireIdempotencyKey(request),
        signal: request.signal,
      }, () => service().prepareTopicPool(access, input), (runId) => {
        if (!runId) throw modelTaskError("MODEL_TASK_RESULT_NOT_FOUND", 409, false)
        return service().getTopicPool(access, runId)
      })
      return Response.json(result, { status: 201 })
    }
    if (request.method === "POST" && segments.join("/") === "scripts") {
      const input = topicScriptSchema.parse(await request.json().catch(() => null))
      const result = await getModelTaskService().run({
        tenantId: access.tenantId,
        actorUserId: access.userId,
        operation: "creation.script",
        idempotencyKey: requireIdempotencyKey(request),
        signal: request.signal,
      }, () => service().createScriptFromTopic(access, input), () => service().createScriptFromTopic(access, input))
      return Response.json(result, { status: 201 })
    }
    if (request.method === "POST" && segments.join("/") === "next-round") {
      const input = nextRoundSchema.parse(await request.json().catch(() => null))
      const result = await getModelTaskService().run({
        tenantId: access.tenantId,
        actorUserId: access.userId,
        operation: "creation.topics.review_followup",
        idempotencyKey: requireIdempotencyKey(request),
        signal: request.signal,
      }, () => service().createNextRound(access, input), (runId) => {
        if (!runId) throw modelTaskError("MODEL_TASK_RESULT_NOT_FOUND", 409, false)
        return service().getTopicPool(access, runId)
      })
      return Response.json(result, { status: 201 })
    }
    if (request.method === "PUT" && segments[0] === "runs" && segments[1] && segments[2] === "draft" && segments.length === 3) {
      return Response.json(service().saveDraft(access, segments[1], await draftMutationInput(request)))
    }
    if (request.method === "POST" && segments[0] === "runs" && segments[1] && segments[2] === "finalize" && segments.length === 3) {
      return Response.json(await service().finalize(access, segments[1], await draftMutationInput(request)))
    }
    if (request.method === "GET" && segments[0] === "runs" && segments[1] && segments[2] === "download" && segments.length === 3) {
      const exported = service().getLockedExport(access, segments[1])
      const bytes = await buildScriptDocx(exported)
      const filename = `${safeFilename(exported.title)}.docx`
      return new Response(new Uint8Array(bytes).buffer, {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": `attachment; filename="script.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "cache-control": "private, no-store",
        },
      })
    }
    if (request.method === "GET" && segments[0] === "runs" && segments[1]) return Response.json(service().getRun(access, segments[1]))
    return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
  } catch (error) {
    return creationErrorResponse(error)
  }
}

function safeFilename(value: string) {
  const cleaned = value.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim()
  return cleaned.slice(0, 64) || "口播稿"
}

type RouteContext = { params: Promise<{ segments: string[] }> }
export const GET = withRequestLog(async (request: NextRequest, context: RouteContext) => dispatch(request, (await context.params).segments))
export const POST = withRequestLog(async (request: NextRequest, context: RouteContext) => dispatch(request, (await context.params).segments))
export const PUT = withRequestLog(async (request: NextRequest, context: RouteContext) => dispatch(request, (await context.params).segments))
