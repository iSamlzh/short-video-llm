import { z } from "zod"
import type { AccessContext } from "@/domain/access"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { WorkspaceContextService } from "@/services/workspace-context-service"
import { withRequestLog } from "@/lib/observability/request-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const switchInputSchema = z.object({
  teamId: z.string().trim().min(1).optional(),
  ipId: z.string().trim().min(1).optional(),
  accountId: z.string().trim().min(1).optional(),
}).refine((input) => input.teamId || input.ipId || input.accountId, "至少选择一项工作上下文")

type ContextService = Pick<WorkspaceContextService, "get" | "switch">

export async function handleWorkspaceContext(
  request: Request,
  access: AccessContext | null,
  service: ContextService,
) {
  if (!access) return Response.json({ errorCode: "UNAUTHENTICATED", message: "请先登录" }, { status: 401 })
  if (access.audience !== "tenant") return Response.json({ errorCode: "TENANT_AUDIENCE_REQUIRED", message: "仅团长工作台可用" }, { status: 403 })
  try {
    if (request.method === "GET") return Response.json(service.get(access.userId))
    if (request.method === "POST") {
      const input = switchInputSchema.parse(await request.json().catch(() => null))
      return Response.json(service.switch(access.userId, input))
    }
    return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
  } catch (error) {
    const failure = error as { code?: string; status?: number; message?: string }
    if (failure.code === "FORBIDDEN_CONTEXT" || failure.message === "FORBIDDEN_CONTEXT") {
      return Response.json({ errorCode: "FORBIDDEN_CONTEXT", message: "无权切换到这个工作空间" }, { status: 403 })
    }
    if (error instanceof z.ZodError) {
      return Response.json({ errorCode: "CONTEXT_INPUT_INVALID", message: "请选择有效的工作空间" }, { status: 400 })
    }
    return Response.json({ errorCode: "CONTEXT_SWITCH_FAILED", message: "暂时无法切换工作空间" }, { status: 500 })
  }
}

function service() {
  return new WorkspaceContextService(getAppDatabase())
}

async function get(request: Request) {
  return handleWorkspaceContext(request, await resolveCurrentAccess(), service())
}

async function post(request: Request) {
  return handleWorkspaceContext(request, await resolveCurrentAccess(), service())
}

export const GET = withRequestLog(get)
export const POST = withRequestLog(post)
