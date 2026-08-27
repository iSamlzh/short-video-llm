import { OperationalHealthService } from "@/services/operational-health-service"
import { withRequestLog } from "@/lib/observability/request-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function get(_request: Request) {
  return Response.json(new OperationalHealthService(null).live(), {
    headers: { "cache-control": "no-store" },
  })
}

export const GET = withRequestLog(get)
