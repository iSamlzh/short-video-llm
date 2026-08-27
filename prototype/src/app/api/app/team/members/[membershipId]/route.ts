import { z } from "zod"
import { capabilities } from "@/domain/access"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { TeamService } from "@/services/team-service"
import { teamFailure } from "../../route"
import { withRequestLog } from "@/lib/observability/request-log"

const updateSchema = z.object({
  roleKey: z.enum(["operator", "reviewer"]),
  capabilities: z.array(z.enum(capabilities)),
  ipIds: z.array(z.string().min(1)),
  contentAccountIds: z.array(z.string().min(1)),
}).strict()
const statusSchema = z.object({ status: z.enum(["active", "disabled"]) }).strict()
type Context = { params: Promise<{ membershipId: string }> }

async function put(request: Request, context: Context) {
  return memberAction(request, context, "access")
}
async function patch(request: Request, context: Context) {
  return memberAction(request, context, "status")
}
async function post(request: Request, context: Context) {
  return memberAction(request, context, "password")
}

export const PUT = withRequestLog(put)
export const PATCH = withRequestLog(patch)
export const POST = withRequestLog(post)

async function memberAction(request: Request, context: Context, action: "access" | "status" | "password") {
  const access = await resolveCurrentAccess()
  if (!access) return Response.json({ errorCode: "UNAUTHENTICATED", message: "请先登录" }, { status: 401 })
  try {
    const service = new TeamService(getAppDatabase())
    const { membershipId } = await context.params
    if (action === "access") return Response.json(service.updateAccess(access, membershipId, updateSchema.parse(await request.json())))
    if (action === "status") return Response.json(service.setStatus(access, membershipId, statusSchema.parse(await request.json()).status))
    return Response.json(await service.resetTemporaryPassword(access, membershipId))
  } catch (error) { return teamFailure(error) }
}
