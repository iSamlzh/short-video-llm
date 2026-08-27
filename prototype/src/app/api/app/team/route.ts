import { z } from "zod"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { TeamService } from "@/services/team-service"
import { withRequestLog } from "@/lib/observability/request-log"

const createSchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(2).max(40),
  roleKey: z.enum(["operator", "reviewer"]),
  ipIds: z.array(z.string().min(1)).min(1),
  contentAccountIds: z.array(z.string().min(1)).min(1),
}).strict()

export const GET = withRequestLog((_request: Request) => handle("GET"))
export const POST = withRequestLog((request: Request) => handle("POST", request))

async function handle(method: "GET" | "POST", request?: Request) {
  const access = await resolveCurrentAccess()
  if (!access) return Response.json({ errorCode: "UNAUTHENTICATED", message: "请先登录" }, { status: 401 })
  try {
    const service = new TeamService(getAppDatabase())
    if (method === "GET") return Response.json(service.list(access))
    const result = await service.createMember(access, createSchema.parse(await request!.json().catch(() => null)))
    return Response.json(result, { status: 201 })
  } catch (error) { return teamFailure(error) }
}

export function teamFailure(error: unknown) {
  const code = (error as { code?: string; message?: string }).code ?? (error as Error).message ?? "TEAM_OPERATION_FAILED"
  const messages: Record<string, string> = {
    EMAIL_ALREADY_EXISTS: "这个邮箱已经存在",
    CANNOT_GRANT_CAPABILITY: "不能授予超出自己权限的能力",
    CANNOT_GRANT_IP_SCOPE: "不能授予自己无权访问的 IP",
    CANNOT_GRANT_ACCOUNT_SCOPE: "不能授予自己无权访问的内容账号",
    CANNOT_DISABLE_SELF: "不能停用自己的账号",
    CANNOT_EDIT_SELF: "不能在团队页修改自己的角色或权限",
    CANNOT_RESET_SELF: "请从个人密码设置修改自己的密码",
    MEMBERSHIP_SCOPE_FORBIDDEN: "成员不属于当前团队",
    CAPABILITY_FORBIDDEN: "当前账号没有团队管理权限",
  }
  const status = code.includes("FORBIDDEN") || code.startsWith("CANNOT_GRANT") ? 403 : 400
  return Response.json({ errorCode: code, message: messages[code] ?? "团队操作未完成" }, { status })
}
