import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { NextRequest } from "next/server"
import { PrototypeRepository } from "@/lib/db/repository"
import { OpenAiCompatibleAdapter } from "@/lib/llm/adapter"
import { StructuredLlmClient } from "@/lib/llm/structured"
import { RunService } from "@/services/run-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let singleton: RunService | undefined
function getService() {
  if (singleton) return singleton
  const dbPath = resolve(process.cwd(), process.env.PROTOTYPE_DB_PATH ?? ".data/prototype.sqlite")
  mkdirSync(dirname(dbPath), { recursive: true })
  singleton = new RunService(new PrototypeRepository(dbPath), new StructuredLlmClient(new OpenAiCompatibleAdapter()))
  return singleton
}

function errorResponse(error: unknown) {
  const value = error as { code?: string; message?: string; retryable?: boolean }
  const code = value.code ?? value.message ?? "INTERNAL_ERROR"
  const status = code === "VERSION_CONFLICT" ? 409 : code === "RUN_NOT_FOUND" ? 404 : 400
  return Response.json({ errorCode: code, message: value.message ?? "操作失败", retryable: Boolean(value.retryable) }, { status })
}

async function dispatch(request: NextRequest, segments: string[]) {
  const service = getService()
  const body = request.method === "POST" ? await request.json().catch(() => ({})) as Record<string, unknown> : {}
  try {
    if (request.method === "POST" && segments.join("/") === "runs") return Response.json(service.createRun(body as never), { status: 201 })
    if (segments[0] !== "runs" || !segments[1]) return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
    const runId = segments[1]
    if (request.method === "GET" && segments.length === 2) return Response.json(service.getRun(runId))
    if (request.method === "POST" && segments.slice(2).join("/") === "topics/generate") {
      return Response.json(await service.generateTopics(runId, Number(body.inputVersion)))
    }
    if (request.method === "POST" && segments.slice(2).join("/") === "topics/select") {
      return Response.json(service.selectTopic(runId, Number(body.batchVersion), String(body.topicId)))
    }
    return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
  } catch (error) { return errorResponse(error) }
}

type RouteContext = { params: Promise<{ segments: string[] }> }
export async function GET(request: NextRequest, context: RouteContext) { return dispatch(request, (await context.params).segments) }
export async function POST(request: NextRequest, context: RouteContext) { return dispatch(request, (await context.params).segments) }
