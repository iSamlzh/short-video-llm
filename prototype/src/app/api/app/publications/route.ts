import type { AccessContext } from "@/domain/access"
import { recordSystemPublicationInputSchema } from "@/domain/growth-loop-schemas"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { requireTenantCapability } from "@/lib/auth/guards"
import { getGrowthLoopServices, type GrowthLoopServices } from "@/services/growth-loop-service-factory"
import { growthLoopFailure, tenantHttpContext } from "@/services/growth-loop-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type PublicationDeps = Pick<GrowthLoopServices, "publications">

export async function handlePublications(
  request: Request,
  access: AccessContext | null,
  deps: PublicationDeps,
) {
  const resolved = tenantHttpContext(access)
  if (resolved.response) return resolved.response
  const context = resolved.context
  try {
    requireTenantCapability(context, "publication.record")
    if (request.method === "POST") {
      const input = recordSystemPublicationInputSchema.parse(await request.json().catch(() => null))
      return Response.json(deps.publications.recordSystem(context, input), { status: 201 })
    }
    if (request.method === "GET") {
      const url = new URL(request.url)
      const runId = url.searchParams.get("runId")?.trim()
      const lockedVersion = Number(url.searchParams.get("lockedVersion"))
      if (!runId || !Number.isInteger(lockedVersion) || lockedVersion < 1) throw new Error("PUBLICATION_QUERY_INVALID")
      return Response.json(deps.publications.getByCurrentLock(context, runId, lockedVersion))
    }
    return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
  } catch (error) {
    return growthLoopFailure(error, "PUBLICATION_INPUT_INVALID")
  }
}

export async function GET(request: Request) {
  return handlePublications(request, await resolveCurrentAccess(), getGrowthLoopServices())
}

export async function POST(request: Request) {
  return handlePublications(request, await resolveCurrentAccess(), getGrowthLoopServices())
}
