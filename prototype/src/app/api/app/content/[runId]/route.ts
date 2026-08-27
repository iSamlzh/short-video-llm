import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { ContentHistoryService } from "@/services/content-history-service"
import { withRequestLog } from "@/lib/observability/request-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function get(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const access = await resolveCurrentAccess()
  if (!access) return Response.json({ errorCode: "UNAUTHENTICATED", message: "请先登录" }, { status: 401 })
  if (access.audience !== "tenant") return Response.json({ errorCode: "TENANT_AUDIENCE_REQUIRED" }, { status: 403 })
  try {
    return Response.json(new ContentHistoryService(getAppDatabase()).detail(access, (await context.params).runId))
  } catch (error) {
    const value = error as { code?: string; message?: string; status?: number }
    const code = value.code ?? value.message ?? "CONTENT_HISTORY_READ_FAILED"
    return Response.json({ errorCode: code, message: value.message ?? "读取内容详情失败" }, { status: value.status ?? (code.includes("FORBIDDEN") ? 403 : 400) })
  }
}

export const GET = withRequestLog(get)
