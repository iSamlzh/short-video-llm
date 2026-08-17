import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { requireTenantCapability } from "@/lib/auth/guards"
import { getAppDatabase } from "@/lib/db/app-database"
import { MetricsReviewService } from "@/services/metrics-review-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function currentScope(userId: string, tenantId: string) {
  const row = getAppDatabase().prepare(`SELECT ip_profile_id, content_account_id FROM user_current_context
    WHERE user_id = ? AND tenant_id = ?`).get(userId, tenantId) as { ip_profile_id: string | null; content_account_id: string | null } | undefined
  if (!row?.ip_profile_id || !row.content_account_id) throw new Error("CURRENT_ACCOUNT_REQUIRED")
  return { tenantId, ipId: row.ip_profile_id, accountId: row.content_account_id }
}

function fail(error: unknown) {
  const value = error as { code?: string; message?: string; status?: number }
  const code = value.code ?? value.message ?? "INTERNAL_ERROR"
  return Response.json({ errorCode: code, message: value.message ?? "操作失败" }, { status: value.status ?? (code.includes("FORBIDDEN") ? 403 : 400) })
}

async function dispatch(request: NextRequest, segments: string[]) {
  const access = await resolveCurrentAccess()
  if (!access) return Response.json({ errorCode: "UNAUTHENTICATED" }, { status: 401 })
  if (access.audience !== "tenant") return Response.json({ errorCode: "TENANT_AUDIENCE_REQUIRED" }, { status: 403 })
  const metrics = new MetricsReviewService(getAppDatabase())
  try {
    const scope = currentScope(access.userId, access.tenantId)
    if (request.method === "GET" && segments.join("/") === "current") {
      requireTenantCapability(access, "review.view", { ipId: scope.ipId, contentAccountId: scope.accountId })
      try { return Response.json(metrics.buildBrief(scope)) } catch (error) {
        if ((error as Error).message === "NO_IMPORTED_METRICS") return new Response(null, { status: 204 })
        throw error
      }
    }
    if (request.method === "POST" && segments.join("/") === "import") {
      requireTenantCapability(access, "metrics.import", { ipId: scope.ipId, contentAccountId: scope.accountId })
      const length = Number(request.headers.get("content-length") ?? 0)
      if (length > 1_000_000) return Response.json({ errorCode: "FILE_TOO_LARGE" }, { status: 413 })
      const body = await request.json() as { csv?: string }
      if (!body.csv) throw new Error("CSV_REQUIRED")
      return Response.json(metrics.importCsv({ ...scope, dataOrigin: "formal" }, body.csv), { status: 201 })
    }
    if (request.method === "POST" && segments.join("/") === "confirm") {
      requireTenantCapability(access, "review.generate", { ipId: scope.ipId, contentAccountId: scope.accountId })
      const brief = metrics.buildBrief(scope)
      const row = getAppDatabase().prepare(`SELECT COALESCE(MAX(version),0)+1 next FROM tenant_memory_versions
        WHERE tenant_id=? AND ip_profile_id=? AND content_account_id=?`).get(scope.tenantId, scope.ipId, scope.accountId) as { next: number }
      getAppDatabase().prepare(`INSERT INTO tenant_memory_versions
        (id,tenant_id,ip_profile_id,content_account_id,version,payload_json,confirmed_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), scope.tenantId, scope.ipId, scope.accountId, row.next, JSON.stringify({ keep: brief.summary, next: brief.next, evidenceLimits: brief.evidenceLimits }), access.userId, new Date().toISOString())
      return Response.json({ confirmed: true, version: row.next })
    }
    return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
  } catch (error) { return fail(error) }
}

type RouteContext = { params: Promise<{ segments: string[] }> }
export async function GET(request: NextRequest, context: RouteContext) { return dispatch(request, (await context.params).segments) }
export async function POST(request: NextRequest, context: RouteContext) { return dispatch(request, (await context.params).segments) }
