import { ZodError } from "zod"
import type { AccessContext, TenantAccessContext } from "../domain/access"

const statusByCode: Record<string, number> = {
  UNAUTHENTICATED: 401,
  TENANT_AUDIENCE_REQUIRED: 403,
  CAPABILITY_FORBIDDEN: 403,
  IP_SCOPE_FORBIDDEN: 404,
  ACCOUNT_SCOPE_FORBIDDEN: 404,
  CURRENT_ACCOUNT_REQUIRED: 409,
  METRIC_BATCH_NOT_FOUND: 404,
  MATCH_NOT_FOUND: 404,
  REVIEW_NOT_FOUND: 404,
  PUBLICATION_NOT_FOUND: 404,
  FILE_TOO_LARGE: 413,
  ROW_LIMIT_EXCEEDED: 400,
  FILE_TYPE_UNSUPPORTED: 400,
  METRIC_HEADERS_INVALID: 400,
  PUBLICATION_ID_CONFLICT: 409,
  PUBLICATION_URL_CONFLICT: 409,
  PUBLICATION_IDENTITY_CONFLICT: 409,
  MATCH_VERSION_CONFLICT: 409,
  REAL_METRICS_REQUIRED: 400,
  MEMORY_SAMPLE_INSUFFICIENT: 409,
  REVIEW_SUPERSEDED: 409,
  LLM_TIMEOUT: 503,
  MODEL_SCHEMA_INVALID: 502,
  MODEL_EVIDENCE_INVALID: 502,
}

const messages: Record<string, string> = {
  UNAUTHENTICATED: "请先登录",
  TENANT_AUDIENCE_REQUIRED: "当前账号不能访问团长端数据",
  CAPABILITY_FORBIDDEN: "当前账号没有执行此操作的权限",
  ACCOUNT_SCOPE_FORBIDDEN: "未找到可访问的内容账号",
  FILE_TOO_LARGE: "文件不能超过 10 MB",
  ROW_LIMIT_EXCEEDED: "单次导入不能超过 10,000 行",
  FILE_TYPE_UNSUPPORTED: "仅支持 CSV 或 XLSX 文件",
  METRIC_HEADERS_INVALID: "文件表头无法识别",
  MATCH_VERSION_CONFLICT: "该匹配已被其他操作更新，请刷新后重试",
  REVIEW_SUPERSEDED: "该复盘已失效，请使用最新复盘",
  MEMORY_SAMPLE_INSUFFICIENT: "至少需要 5 条独立发布才能形成长期记忆",
  LLM_TIMEOUT: "模型响应超时，可以直接重试复盘",
  MODEL_SCHEMA_INVALID: "模型返回结构不完整，可以直接重试复盘",
  MODEL_EVIDENCE_INVALID: "模型引用了未批准的证据，可以直接重试复盘",
}

export function tenantHttpContext(access: AccessContext | null):
  { context: TenantAccessContext; response?: never } | { context?: never; response: Response } {
  if (!access) return { response: errorResponse("UNAUTHENTICATED", 401) }
  if (access.audience !== "tenant") return { response: errorResponse("TENANT_AUDIENCE_REQUIRED", 403) }
  return { context: access }
}

export function growthLoopFailure(error: unknown, inputCode?: string) {
  if (error instanceof ZodError) return errorResponse(inputCode ?? "INPUT_INVALID", 400)
  const value = error as { code?: string; message?: string; retryable?: boolean }
  const rawCode = value.code ?? value.message ?? "INTERNAL_ERROR"
  const code = /^[A-Z][A-Z0-9_]+$/.test(rawCode) ? rawCode : "INTERNAL_ERROR"
  const status = statusByCode[code] ?? (code.endsWith("_INVALID") || code.endsWith("_REQUIRED") ? 400 : 500)
  return Response.json({
    errorCode: code,
    message: messages[code] ?? (status >= 500 ? "服务暂时不可用" : "请求无法处理"),
    retryable: Boolean(value.retryable) || status === 502 || status === 503,
  }, { status })
}

function errorResponse(errorCode: string, status: number) {
  return Response.json({ errorCode, message: messages[errorCode] ?? "请求无法处理", retryable: false }, { status })
}
