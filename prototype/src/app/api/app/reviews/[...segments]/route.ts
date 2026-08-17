import type { AccessContext, TenantAccessContext } from "@/domain/access"
import { confirmMemoryInputSchema } from "@/domain/growth-loop-schemas"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { requireTenantCapability } from "@/lib/auth/guards"
import { getGrowthLoopServices, type GrowthLoopServices } from "@/services/growth-loop-service-factory"
import { growthLoopFailure, tenantHttpContext } from "@/services/growth-loop-http"
import { z } from "zod"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ReviewDeps = Pick<GrowthLoopServices, "reviews" | "memory">
const accountInputSchema = z.object({ contentAccountId: z.string().trim().min(1) }).strict()
const memoryFieldsSchema = confirmMemoryInputSchema.omit({ reviewId: true }).strict()

export async function handleReviews(
  request: Request,
  segments: string[],
  access: AccessContext | null,
  deps: ReviewDeps,
) {
  const resolved = tenantHttpContext(access)
  if (resolved.response) return resolved.response
  const context = resolved.context
  try {
    if (request.method === "GET" && segments.length === 1 && segments[0] === "current") {
      requireTenantCapability(context, "review.view")
      const contentAccountId = new URL(request.url).searchParams.get("contentAccountId")?.trim()
      if (!contentAccountId) throw new Error("CONTENT_ACCOUNT_REQUIRED")
      const review = deps.reviews.getCurrent(context, contentAccountId)
      return review ? Response.json(presentReview(review, context)) : new Response(null, { status: 204 })
    }
    if (request.method === "POST" && segments.length === 1 && segments[0] === "generate") {
      requireTenantCapability(context, "review.generate")
      const input = accountInputSchema.parse(await request.json().catch(() => null))
      const review = await deps.reviews.generateCurrent(context, input.contentAccountId)
      return Response.json(presentReview(review, context), { status: 201 })
    }
    if (request.method === "POST" && segments[0] && segments[1] === "confirm" && segments.length === 2) {
      requireTenantCapability(context, "review.confirm")
      const input = memoryFieldsSchema.parse(await request.json().catch(() => null))
      return Response.json(deps.memory.confirm(context, { reviewId: segments[0], ...input }), { status: 201 })
    }
    return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
  } catch (error) {
    return growthLoopFailure(error, "REVIEW_INPUT_INVALID")
  }
}

function presentReview(
  review: { sampleTier: string; status: string; payload: { evidenceLimits: string }; [key: string]: unknown },
  context: TenantAccessContext,
) {
  return {
    ...review,
    canConfirm: review.sampleTier === "memory_eligible"
      && review.status === "generated"
      && context.capabilities.includes("review.confirm"),
    evidenceLimits: review.payload.evidenceLimits,
    retryable: false,
  }
}

type RouteContext = { params: Promise<{ segments: string[] }> }
export async function GET(request: Request, route: RouteContext) {
  return handleReviews(request, (await route.params).segments, await resolveCurrentAccess(), getGrowthLoopServices())
}
export async function POST(request: Request, route: RouteContext) {
  return handleReviews(request, (await route.params).segments, await resolveCurrentAccess(), getGrowthLoopServices())
}
