import { getAppDatabase } from "@/lib/db/app-database"
import { OperationalHealthService } from "@/services/operational-health-service"
import { withRequestLog } from "@/lib/observability/request-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function get(_request: Request) {
  const result = new OperationalHealthService(getAppDatabase()).ready()
  return Response.json(result, {
    status: result.status === "ready" ? 200 : 503,
    headers: { "cache-control": "no-store" },
  })
}

export const GET = withRequestLog(get)
