export function requireIdempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim()
  if (!value) {
    throw Object.assign(new Error("模型生成请求缺少幂等键"), {
      code: "IDEMPOTENCY_KEY_MISSING",
      status: 400,
      retryable: false,
    })
  }
  return value
}

export function deprecationHeaders(replacement: string) {
  return {
    Deprecation: "true",
    Link: `<${replacement}>; rel="successor-version"`,
    Warning: `299 - "Deprecated API; use ${replacement}"`,
  }
}
