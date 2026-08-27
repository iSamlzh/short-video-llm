export type LogLevel = "info" | "warn" | "error"

type LogValue = string | number | boolean | null | undefined

export function structuredLog(level: LogLevel, event: string, detail: Record<string, LogValue>) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...withoutUndefined(detail),
  })

  // systemd 将 stdout 和 stderr 分别写入访问日志与异常日志。
  // 4xx 属于可预期业务拒绝，保留在短期访问日志；5xx 与运行异常写 stderr。
  if (level === "error") console.error(entry)
  else console.info(entry)
}

function withoutUndefined(detail: Record<string, LogValue>) {
  return Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== undefined))
}
