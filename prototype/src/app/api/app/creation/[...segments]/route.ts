import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { NextRequest } from "next/server"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { PrototypeRepository } from "@/lib/db/repository"
import { OpenAiCompatibleAdapter } from "@/lib/llm/adapter"
import { PrototypeFixtureLlmAdapter } from "@/lib/llm/fake"
import { StructuredLlmClient } from "@/lib/llm/structured"
import { RunService } from "@/services/run-service"
import { AutoCreationOrchestrator } from "@/services/auto-creation-orchestrator"
import { CreationAppService } from "@/services/creation-app-service"
import { ContentBrainRepository } from "@/lib/db/content-brain-repository"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let singleton: CreationAppService | undefined
function service() {
  if (singleton) return singleton
  const path = resolve(/* turbopackIgnore: true */ process.cwd(), process.env.PROTOTYPE_DB_PATH ?? ".data/prototype.sqlite")
  mkdirSync(dirname(path), { recursive: true })
  const repository = new PrototypeRepository(path)
  const fixtureAllowed = process.env.PROTOTYPE_TEST_MODE === "true" && process.env.PLAYWRIGHT_TEST_MODE === "true"
  const llm = new StructuredLlmClient(fixtureAllowed ? new PrototypeFixtureLlmAdapter() : new OpenAiCompatibleAdapter())
  const contentBrain = new ContentBrainRepository(getAppDatabase())
  const runs = new RunService(repository, llm, () => {
    const structures = contentBrain.retrieveStructures()
    if (!structures.length) throw Object.assign(new Error("平台尚未启用可用的内容结构"), { code: "NO_ACTIVE_TEMPLATE" })
    return structures
  })
  singleton = new CreationAppService(getAppDatabase(), runs, new AutoCreationOrchestrator(runs))
  return singleton
}

function fail(error: unknown) {
  const value = error as { code?: string; message?: string; retryable?: boolean; status?: number }
  const code = value.code ?? value.message ?? "INTERNAL_ERROR"
  const status = value.status ?? (code === "RUN_NOT_FOUND" ? 404 : code.includes("FORBIDDEN") ? 403 : 400)
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
    if (request.method === "POST" && segments.join("/") === "auto") return Response.json(await service().create(access), { status: 201 })
    if (request.method === "GET" && segments[0] === "runs" && segments[1]) return Response.json(service().getRun(access, segments[1]))
    return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
  } catch (error) {
    return fail(error)
  }
}

type RouteContext = { params: Promise<{ segments: string[] }> }
export async function GET(request: NextRequest, context: RouteContext) { return dispatch(request, (await context.params).segments) }
export async function POST(request: NextRequest, context: RouteContext) { return dispatch(request, (await context.params).segments) }
