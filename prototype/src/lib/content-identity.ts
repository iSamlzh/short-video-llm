export function normalizeVideoUrl(value: string) {
  const url = new URL(value)
  url.hostname = url.hostname.toLowerCase()
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    url.searchParams.delete(key)
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "")
  url.hash = ""
  return url.toString()
}

export function normalizeContentTitle(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, " ")
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
}
