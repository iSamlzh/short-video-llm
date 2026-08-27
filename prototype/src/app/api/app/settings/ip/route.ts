import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { IpAccountManagementService } from "@/services/ip-account-management-service"
import { withRequestLog } from "@/lib/observability/request-log"

async function get(_request: Request) {
  const access = await resolveCurrentAccess()
  if (!access) return Response.json({ errorCode: "UNAUTHENTICATED", message: "请先登录" }, { status: 401 })
  if (access.audience !== "tenant") return Response.json({ errorCode: "TENANT_AUDIENCE_REQUIRED" }, { status: 403 })
  try { return Response.json(new IpAccountManagementService(getAppDatabase()).list(access)) }
  catch { return Response.json({ errorCode: "CAPABILITY_FORBIDDEN", message: "当前账号没有 IP 管理权限" }, { status: 403 }) }
}

export const GET = withRequestLog(get)
