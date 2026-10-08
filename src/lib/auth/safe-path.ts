/** Only same-origin relative paths. Rejects protocol-relative and absolute URLs. */
export function safeNextPath(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string") {
    return fallback
  }
  const trimmed = raw.trim()
  if (!trimmed.startsWith("/")) {
    return fallback
  }
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback
  }
  if (trimmed.includes("://") || trimmed.includes("\\")) {
    return fallback
  }
  return trimmed
}
