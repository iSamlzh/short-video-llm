const messages: Record<string, string> = {
  IDEMPOTENCY_KEY_INVALID: "生成请求标识无效，请刷新页面后重试",
  MODEL_GLOBAL_CONCURRENCY_LIMIT: "当前生成任务较多，请稍后重试",
  MODEL_TENANT_CONCURRENCY_LIMIT: "当前团队已有多个内容任务正在生成，请稍后重试",
  MODEL_DAILY_TASK_LIMIT: "今天的内容生成次数已达上限，请联系管理员调整额度",
  MODEL_DAILY_TOKEN_LIMIT: "今天的模型用量已达上限，请联系管理员调整额度",
  MODEL_TASK_IN_PROGRESS: "这次内容任务仍在生成，请稍后查看",
  MODEL_TASK_ALREADY_SUCCEEDED: "这次内容任务已经完成",
  MODEL_TASK_PREVIOUSLY_FAILED: "上次生成未完成，请重新发起",
  MODEL_TASK_CANCELLED: "已取消本次模型生成",
  MODEL_TASK_RESULT_NOT_FOUND: "任务已完成，但没有找到对应内容，请重新生成",
}

export function modelTaskError(code: string, status: number, retryable: boolean, message?: string) {
  return Object.assign(new Error(message ?? messages[code] ?? "内容生成任务未完成"), {
    code,
    status,
    retryable,
  })
}
