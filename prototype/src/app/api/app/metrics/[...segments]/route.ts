import type { AccessContext } from "@/domain/access"
import { confirmMatchInputSchema } from "@/domain/growth-loop-schemas"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { requireTenantCapability } from "@/lib/auth/guards"
import { getGrowthLoopServices, type GrowthLoopServices } from "@/services/growth-loop-service-factory"
import { growthLoopFailure, tenantHttpContext } from "@/services/growth-loop-http"
import { z } from "zod"
import { withRequestLog } from "@/lib/observability/request-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type MetricDeps = Pick<GrowthLoopServices, "currentScope" | "imports" | "matcher">
const externalMatchSchema = z.object({ expectedVersion: z.number().int().positive() }).strict()

export async function handleMetrics(
  request: Request,
  segments: string[],
  access: AccessContext | null,
  deps: MetricDeps,
) {
  const resolved = tenantHttpContext(access)
  if (resolved.response) return resolved.response
  const context = resolved.context
  try {
    requireTenantCapability(context, "metrics.import")
    if (request.method === "POST" && segments.length === 1 && segments[0] === "imports") {
      const scope = deps.currentScope.get(context)
      requireTenantCapability(context, "metrics.import", { ipId: scope.ipId, contentAccountId: scope.contentAccountId })
      const form = await request.formData()
      const file = form.get("file")
      if (!(file instanceof File)) throw new Error("METRIC_FILE_REQUIRED")
      const result = await deps.imports.import(context, {
        contentAccountId: scope.contentAccountId,
        filename: file.name,
        mimeType: file.type,
        bytes: Buffer.from(await file.arrayBuffer()),
      })
      return Response.json(result, { status: 201 })
    }
    if (request.method === "GET" && segments[0] === "imports" && segments[1] && segments.length === 2) {
      return Response.json(deps.imports.getResult(context, segments[1]))
    }
    if (request.method === "POST" && segments[0] === "matches" && segments[1] && segments[2] === "confirm" && segments.length === 3) {
      const input = confirmMatchInputSchema.parse(await request.json().catch(() => null))
      return Response.json(deps.matcher.confirmCandidate(
        context, segments[1], input.publicationId, input.expectedVersion,
      ))
    }
    if (request.method === "POST" && segments[0] === "matches" && segments[1] && segments[2] === "external" && segments.length === 3) {
      const input = externalMatchSchema.parse(await request.json().catch(() => null))
      return Response.json(deps.matcher.rejectCandidateAndCreateExternal(context, segments[1], input.expectedVersion), { status: 201 })
    }
    return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
  } catch (error) {
    return growthLoopFailure(error, "METRIC_INPUT_INVALID")
  }
}

type RouteContext = { params: Promise<{ segments: string[] }> }
async function get(request: Request, route: RouteContext) {
  return handleMetrics(request, (await route.params).segments, await resolveCurrentAccess(), getGrowthLoopServices())
}
async function post(request: Request, route: RouteContext) {
  return handleMetrics(request, (await route.params).segments, await resolveCurrentAccess(), getGrowthLoopServices())
}

export const GET = withRequestLog(get)
export const POST = withRequestLog(post)
