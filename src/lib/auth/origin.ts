export const LOCAL_DEV_ORIGIN = "http://127.0.0.1:43173"
export const LOCAL_DEV_ORIGINS = [
  "http://127.0.0.1:43173",
  "http://localhost:43173",
] as const

const LOCAL_SYNC_ORIGIN_LITERAL = 'var SYNC_ORIGIN = "http://127.0.0.1:43173"'

export function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase()
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  )
}

export function parseAppOrigin(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error("origin is empty")
  }
  if (/\s/.test(trimmed)) {
    throw new Error("origin must not contain whitespace")
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error("origin is not a valid URL")
  }
  if (url.username || url.password) {
    throw new Error("origin must not include credentials")
  }
  if (url.search || url.hash) {
    throw new Error("origin must not include a query or fragment")
  }
  if (url.pathname && url.pathname !== "/") {
    throw new Error("origin must not include a path")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("origin must be http or https")
  }
  if (url.hostname.includes("*")) {
    throw new Error("origin must not use a wildcard host")
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new Error("HTTP is only allowed for localhost development")
  }
  return url.origin
}

type OriginEnv = Record<string, string | undefined>

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = (value ?? "").trim()
    if (trimmed) {
      return trimmed
    }
  }
  return undefined
}

/** HTTPS origin Vercel provides for this deployment. Undefined off Vercel. */
export function vercelHttpsOrigin(env: OriginEnv = process.env): string | undefined {
  if ((env.VERCEL ?? "").trim() !== "1") {
    return undefined
  }
  const host =
    env.VERCEL_ENV === "production"
      ? firstNonEmpty(env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL)
      : firstNonEmpty(env.VERCEL_BRANCH_URL, env.VERCEL_URL)
  if (!host) {
    return undefined
  }
  const candidate = host.includes("://") ? host : `https://${host}`
  return parseAppOrigin(candidate)
}

export function resolveAppOrigin(
  raw: string | undefined,
  nodeEnv: string,
  vercelOrigin?: string
): string {
  const trimmed = (raw ?? "").trim()
  if (trimmed) {
    return parseAppOrigin(trimmed)
  }
  const fromVercel = (vercelOrigin ?? "").trim()
  if (fromVercel) {
    return parseAppOrigin(fromVercel)
  }
  if (nodeEnv === "production") {
    throw new Error(
      "APP_ORIGIN is required in production. Set it to the HTTPS site origin with no path, query, or trailing slash. On Vercel, the deployment URL is used when APP_ORIGIN is unset."
    )
  }
  return LOCAL_DEV_ORIGIN
}

export function allowedRequestOrigins(appOrigin: string): string[] {
  const canonical = parseAppOrigin(appOrigin)
  const allowed = new Set<string>([canonical])
  if (isLoopbackHost(new URL(canonical).hostname)) {
    for (const extra of LOCAL_DEV_ORIGINS) {
      allowed.add(extra)
    }
  }
  return [...allowed]
}

export function bakeUserscriptSyncOrigin(source: string, origin: string): string {
  const parsed = parseAppOrigin(origin)
  const host = new URL(parsed).hostname
  if (!host || host.includes("*")) {
    throw new Error("refusing to bake a wildcard @connect host")
  }
  if (!source.includes(LOCAL_SYNC_ORIGIN_LITERAL)) {
    throw new Error("userscript is missing the local SYNC_ORIGIN literal")
  }
  if (!/^\/\/ @connect\s+127\.0\.0\.1$/m.test(source)) {
    throw new Error("userscript is missing the local @connect host")
  }
  return source
    .replace(/^\/\/ @connect\s+127\.0\.0\.1$/m, `// @connect      ${host}`)
    .replaceAll(LOCAL_SYNC_ORIGIN_LITERAL, `var SYNC_ORIGIN = "${parsed}"`)
}
