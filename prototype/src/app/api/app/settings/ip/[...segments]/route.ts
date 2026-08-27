import { z } from "zod"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { IpAccountManagementService } from "@/services/ip-account-management-service"
import { withRequestLog } from "@/lib/observability/request-log"

const profileSchema = z.object({ expectedVersion: z.number().int().positive(), displayName: z.string().trim().min(1).max(60), profile: z.unknown(), changeSummary: z.string().trim().min(2).max(200) }).strict()
const accountSchema = z.object({ platform: z.enum(["wechat_channels", "douyin", "xiaohongshu", "kuaishou", "other"]), accountName: z.string().trim().min(1).max(80), platformAccountId: z.string().trim().max(120).optional() }).strict()
const accountUpdateSchema = accountSchema.omit({ platform: true })
type Context = { params: Promise<{ segments: string[] }> }

async function dispatch(request: Request, segments: string[]) {
  const access = await resolveCurrentAccess()
  if (!access) return Response.json({ errorCode: "UNAUTHENTICATED", message: "请先登录" }, { status: 401 })
  if (access.audience !== "tenant") return Response.json({ errorCode: "TENANT_AUDIENCE_REQUIRED" }, { status: 403 })
  const service = new IpAccountManagementService(getAppDatabase())
  try {
    if (request.method === "GET" && segments.length === 0) return Response.json(service.list(access))
    if (request.method === "PUT" && segments[0] === "ips" && segments[1] && segments[2] === "profile") return Response.json(service.updateProfile(access, segments[1], profileSchema.parse(await request.json())))
    if (request.method === "POST" && segments[0] === "ips" && segments[1] && segments[2] === "archive") return Response.json(service.setIpStatus(access, segments[1], "disabled"))
    if (request.method === "POST" && segments[0] === "ips" && segments[1] && segments[2] === "restore") return Response.json(service.setIpStatus(access, segments[1], "active"))
    if (request.method === "POST" && segments[0] === "ips" && segments[1] && segments[2] === "accounts") return Response.json(service.createAccount(access, segments[1], accountSchema.parse(await request.json())), { status: 201 })
    if (request.method === "PUT" && segments[0] === "accounts" && segments[1] && segments.length === 2) return Response.json(service.updateAccount(access, segments[1], accountUpdateSchema.parse(await request.json())))
    if (request.method === "POST" && segments[0] === "accounts" && segments[1] && segments[2] === "default") return Response.json(service.setDefaultAccount(access, segments[1]))
    if (request.method === "POST" && segments[0] === "accounts" && segments[1] && segments[2] === "archive") return Response.json(service.setAccountStatus(access, segments[1], "disabled"))
    if (request.method === "POST" && segments[0] === "accounts" && segments[1] && segments[2] === "restore") return Response.json(service.setAccountStatus(access, segments[1], "active"))
    return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
  } catch (error) {
    const value = error as { code?: string; status?: number; message?: string }
    const code = value.code ?? value.message ?? "IP_MANAGEMENT_FAILED"
    const messages: Record<string, string> = { IP_VERSION_CONFLICT: "画像已被更新，请刷新后重试", LAST_ACTIVE_IP: "至少保留一个可用 IP", IP_SCOPE_FORBIDDEN: "无权管理这个 IP", ACCOUNT_SCOPE_FORBIDDEN: "无权管理这个账号", ACCOUNT_DISABLED: "停用账号不能设为默认账号", CAPABILITY_FORBIDDEN: "当前账号没有 IP 管理权限" }
    return Response.json({ errorCode: code, message: messages[code] ?? "操作未完成" }, { status: value.status ?? (code.includes("FORBIDDEN") ? 403 : 400) })
  }
}

export const GET = withRequestLog(async (request: Request, context: Context) => dispatch(request, (await context.params).segments))
export const POST = withRequestLog(async (request: Request, context: Context) => dispatch(request, (await context.params).segments))
export const PUT = withRequestLog(async (request: Request, context: Context) => dispatch(request, (await context.params).segments))
