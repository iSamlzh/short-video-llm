import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getIpPortraitService } from "@/services/ip-portrait-service-factory"

export async function POST(request: Request) {
  const access = await resolveCurrentAccess()
  if (!access) return Response.json({ errorCode: "UNAUTHENTICATED" }, { status: 401 })
  if (access.audience !== "tenant") return Response.json({ errorCode: "TENANT_AUDIENCE_REQUIRED" }, { status: 403 })
  try {
    return Response.json(await getIpPortraitService().generatePreview(await request.json()))
  } catch (error) {
    const value = error as { message?: string; code?: string; retryable?: boolean }
    const errorCode = value.code ?? value.message ?? "PORTRAIT_GENERATION_FAILED"
    const validationError = errorCode === "INTRODUCTION_TOO_SHORT" || errorCode === "DISPLAY_NAME_REQUIRED"
    const status = validationError ? 400 : 502
    const message = errorCode === "INTRODUCTION_TOO_SHORT"
      ? "请再多介绍一些你的经历、擅长的事和想服务的人"
      : errorCode === "DISPLAY_NAME_REQUIRED"
        ? "请填写希望大家怎么称呼你"
        : value.message ?? "暂时无法生成 IP 画像"
    return Response.json({ errorCode, message, retryable: value.retryable ?? status >= 500 }, { status })
  }
}
