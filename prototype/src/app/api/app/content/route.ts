import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { ContentHistoryService, type ContentHistoryStatus } from "@/services/content-history-service"
import { withRequestLog } from "@/lib/observability/request-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function get(request: Request) {
  const access = await resolveCurrentAccess()
  if (!access) return Response.json({ errorCode: "UNAUTHENTICATED", message: "请先登录" }, { status: 401 })
  if (access.audience !== "tenant") return Response.json({ errorCode: "TENANT_AUDIENCE_REQUIRED" }, { status: 403 })
  try {
    const query = new URL(request.url).searchParams
    return Response.json(new ContentHistoryService(getAppDatabase()).list(access, {
      page: optionalNumber(query.get("page")),
      pageSize: optionalNumber(query.get("pageSize")),
      ipId: optionalText(query.get("ipId")),
      accountId: optionalText(query.get("accountId")),
      status: optionalText(query.get("status")) as ContentHistoryStatus | undefined,
      from: optionalText(query.get("from")),
      to: optionalText(query.get("to")),
      keyword: optionalText(query.get("keyword")),
    }))
  } catch (error) {
    return historyFailure(error)
  }
}

export const GET = withRequestLog(get)

function optionalText(value: string | null) { return value?.trim() || undefined }
function optionalNumber(value: string | null) { return value ? Number(value) : undefined }
function historyFailure(error: unknown) {
  const value = error as { code?: string; message?: string; status?: number }
  const code = value.code ?? value.message ?? "CONTENT_HISTORY_READ_FAILED"
  return Response.json({ errorCode: code, message: value.message ?? "读取内容记录失败" }, { status: value.status ?? (code.includes("FORBIDDEN") ? 403 : 400) })
}
