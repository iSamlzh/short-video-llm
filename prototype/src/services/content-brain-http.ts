import { ZodError } from "zod"
import type { AccessContext, PlatformAccessContext } from "../domain/access"

const statusByCode: Record<string, number> = {
  UNAUTHENTICATED: 401,
  PLATFORM_AUDIENCE_REQUIRED: 403,
  PLATFORM_ADMIN_REQUIRED: 403,
  CONTENT_SAMPLE_NOT_FOUND: 404,
  CONTENT_ANALYSIS_NOT_FOUND: 404,
  AGENT_JOB_NOT_FOUND: 404,
  STRUCTURE_CANDIDATE_NOT_FOUND: 404,
  TEMPLATE_VERSION_NOT_FOUND: 404,
  STRUCTURE_EVALUATION_NOT_FOUND: 404,
  SAMPLE_VERSION_CONFLICT: 409,
  ANALYSIS_VERSION_CONFLICT: 409,
  CANDIDATE_VERSION_CONFLICT: 409,
  ANALYSIS_NOT_REVIEWABLE: 409,
  REVIEWED_ANALYSIS_REQUIRED: 409,
  CANDIDATE_NOT_EDITABLE: 409,
  CANDIDATE_NOT_PREVIEWABLE: 409,
  CANDIDATE_NOT_ACTIVATABLE: 409,
  CANDIDATE_NOT_REJECTABLE: 409,
  TEMPLATE_VERSION_NOT_ACTIVE: 409,
  TEMPLATE_VERSION_NOT_ROLLBACKABLE: 409,
  PREVIEW_REQUIRED: 409,
  APPROVED_ANALYSIS_RESULT_NOT_FOUND: 409,
  STRUCTURE_PREVIEW_NOT_FOUND: 409,
  STRUCTURE_EVALUATION_STALE: 409,
  EVALUATION_THRESHOLD_NOT_MET: 409,
  STRUCTURE_EVOLUTION_CANDIDATES_DISABLED: 409,
  EVIDENCE_REFERENCE_INVALID: 502,
  EVOLUTION_TEMPLATE_LINEAGE_INVALID: 502,
  EVOLUTION_CONFIDENCE_EXCEEDS_EVIDENCE: 502,
  EVOLUTION_CHANGE_TYPE_INVALID: 502,
  STRUCTURE_NODE_KEY_DUPLICATE: 502,
  EVOLUTION_RISK_RULE_REMOVAL_FORBIDDEN: 502,
  EVOLUTION_NO_MATERIAL_CHANGE: 502,
  EVOLUTION_MULTIPLE_CHANGE_TYPES: 502,
  AGENT_JOB_NOT_RETRYABLE: 409,
  IDEMPOTENCY_KEY_MISSING: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  MODEL_TASK_IN_PROGRESS: 409,
  MODEL_TASK_ALREADY_SUCCEEDED: 409,
  MODEL_TASK_PREVIOUSLY_FAILED: 409,
  MODEL_GLOBAL_CONCURRENCY_LIMIT: 429,
  MODEL_PLATFORM_CONCURRENCY_LIMIT: 429,
  MODEL_DAILY_TASK_LIMIT: 429,
  MODEL_DAILY_TOKEN_LIMIT: 429,
  LLM_TIMEOUT: 504,
  LLM_RATE_LIMITED: 503,
  MODEL_SCHEMA_INVALID: 502,
  CONTENT_ANALYSIS_EVIDENCE_INVALID: 502,
}

const messages: Record<string, string> = {
  UNAUTHENTICATED: "请先登录",
  PLATFORM_AUDIENCE_REQUIRED: "当前账号不能访问平台内容资产",
  PLATFORM_ADMIN_REQUIRED: "当前操作需要平台管理员权限",
  CONTENT_SAMPLE_NOT_FOUND: "未找到该爆款样本",
  CONTENT_ANALYSIS_NOT_FOUND: "未找到该拆解版本",
  AGENT_JOB_NOT_FOUND: "未找到该 Agent 任务",
  STRUCTURE_CANDIDATE_NOT_FOUND: "未找到该结构候选",
  TEMPLATE_VERSION_NOT_FOUND: "未找到该结构版本",
  STRUCTURE_EVALUATION_NOT_FOUND: "未找到该结构评估",
  SAMPLE_VERSION_CONFLICT: "样本已被更新，请刷新后重试",
  ANALYSIS_VERSION_CONFLICT: "拆解已被更新，请刷新后重试",
  CANDIDATE_VERSION_CONFLICT: "结构候选已被更新，请刷新后重试",
  ANALYSIS_NOT_REVIEWABLE: "当前拆解状态不能复核",
  REVIEWED_ANALYSIS_REQUIRED: "请先完成人工复核",
  CANDIDATE_NOT_EDITABLE: "当前结构候选不能修改",
  CANDIDATE_NOT_PREVIEWABLE: "当前结构候选不能试生成",
  CANDIDATE_NOT_ACTIVATABLE: "当前结构候选不能启用",
  CANDIDATE_NOT_REJECTABLE: "当前结构候选不能驳回",
  TEMPLATE_VERSION_NOT_ACTIVE: "该版本当前未启用",
  TEMPLATE_VERSION_NOT_ROLLBACKABLE: "该版本当前不能回退",
  PREVIEW_REQUIRED: "请先完成试生成并复核结果",
  REJECTION_REASON_REQUIRED: "请填写驳回原因",
  ACTIVATION_REASON_REQUIRED: "请填写启用原因",
  DEACTIVATION_REASON_REQUIRED: "请填写停用原因",
  ROLLBACK_REASON_REQUIRED: "请填写回退原因",
  CONTENT_SAMPLE_FILE_REQUIRED: "请选择要导入的样本文件",
  LLM_TIMEOUT: "模型响应超时，可以直接重试",
  LLM_RATE_LIMITED: "模型服务繁忙，请稍后重试",
  MODEL_SCHEMA_INVALID: "模型返回结构不完整，可以直接重试",
  CONTENT_ANALYSIS_EVIDENCE_INVALID: "模型证据引用无效，可以直接重试",
  STRUCTURE_EVALUATION_STALE: "该评估已被新版本替代，请刷新后重试",
  EVALUATION_THRESHOLD_NOT_MET: "真实数据尚未达到结构候选门槛",
  STRUCTURE_EVOLUTION_CANDIDATES_DISABLED: "结构候选生成处于灰度关闭状态",
  EVIDENCE_REFERENCE_INVALID: "模型引用了评估范围外的证据，可以直接重试",
  EVOLUTION_TEMPLATE_LINEAGE_INVALID: "模型返回的结构版本链路不完整，可以直接重试",
  EVOLUTION_CONFIDENCE_EXCEEDS_EVIDENCE: "模型结论超过当前证据等级，可以直接重试",
  EVOLUTION_CHANGE_TYPE_INVALID: "模型返回的结构修改类型不正确，可以直接重试",
  STRUCTURE_NODE_KEY_DUPLICATE: "模型返回了重复的结构节点，可以直接重试",
  EVOLUTION_RISK_RULE_REMOVAL_FORBIDDEN: "结构候选不得删除现有风险边界",
  EVOLUTION_NO_MATERIAL_CHANGE: "模型未提供有效的结构修改",
  EVOLUTION_MULTIPLE_CHANGE_TYPES: "单次候选包含多类修改，已阻止进入复核",
  AGENT_JOB_NOT_RETRYABLE: "当前任务不能重新执行",
  IDEMPOTENCY_KEY_MISSING: "请求缺少幂等标识，请刷新后重试",
  IDEMPOTENCY_KEY_INVALID: "请求幂等标识格式不正确",
  MODEL_TASK_IN_PROGRESS: "同一任务正在处理中，请稍候",
  MODEL_TASK_ALREADY_SUCCEEDED: "该任务已经完成，请刷新页面",
  MODEL_TASK_PREVIOUSLY_FAILED: "上次任务失败，请使用新的请求重试",
  MODEL_GLOBAL_CONCURRENCY_LIMIT: "模型任务繁忙，请稍后重试",
  MODEL_PLATFORM_CONCURRENCY_LIMIT: "平台内容任务繁忙，请稍后重试",
  MODEL_DAILY_TASK_LIMIT: "今日模型任务额度已用完",
  MODEL_DAILY_TOKEN_LIMIT: "今日模型用量额度已用完",
}

export function platformHttpContext(access: AccessContext | null):
  { context: PlatformAccessContext; response?: never } | { context?: never; response: Response } {
  if (!access) return { response: errorResponse("UNAUTHENTICATED", 401) }
  if (access.audience !== "platform") return { response: errorResponse("PLATFORM_AUDIENCE_REQUIRED", 403) }
  return { context: access }
}

export function contentBrainFailure(error: unknown, inputCode = "CONTENT_BRAIN_INPUT_INVALID") {
  if (error instanceof ZodError || error instanceof SyntaxError) return errorResponse(inputCode, 400)
  const value = error as { code?: string; message?: string; retryable?: boolean; status?: number }
  const rawCode = value.code ?? value.message ?? "INTERNAL_ERROR"
  const code = /^[A-Z][A-Z0-9_]+$/.test(rawCode) ? rawCode : "INTERNAL_ERROR"
  const status = value.status ?? statusByCode[code] ?? (code.endsWith("_INVALID") || code.endsWith("_REQUIRED") ? 400 : 500)
  return errorResponse(code, status, Boolean(value.retryable) || status === 502 || status === 503 || status === 504)
}

export function contentBrainNotFound() {
  return errorResponse("NOT_FOUND", 404)
}

function errorResponse(errorCode: string, status: number, retryable = false) {
  return Response.json({
    errorCode,
    message: messages[errorCode] ?? (status >= 500 ? "服务暂时不可用" : "请求无法处理"),
    retryable,
  }, { status })
}
