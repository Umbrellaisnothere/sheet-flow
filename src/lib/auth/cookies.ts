import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  cookieSecure,
  type AuthEnv,
} from "./config.ts"

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) {
    return {}
  }
  const out: Record<string, string> = {}
  for (const part of header.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) {
      continue
    }
    const key = part.slice(0, idx).trim()
    let value = part.slice(idx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }
    try {
      out[key] = decodeURIComponent(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

export function cookiesFromResponse(response: Response): Record<string, string> {
  const lines =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : []
  const out: Record<string, string> = {}
  for (const line of lines) {
    const first = line.split(";")[0]
    const idx = first.indexOf("=")
    if (idx === -1) {
      continue
    }
    const key = first.slice(0, idx).trim()
    const raw = first.slice(idx + 1).trim()
    try {
      out[key] = decodeURIComponent(raw)
    } catch {
      out[key] = raw
    }
  }
  return out
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge: number
    origin: string
    httpOnly?: boolean
  }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${Math.max(0, options.maxAge)}`,
    "SameSite=Lax",
  ]
  if (options.httpOnly !== false) {
    parts.push("HttpOnly")
  }
  if (cookieSecure(options.origin)) {
    parts.push("Secure")
  }
  return parts.join("; ")
}

export function appendCookie(headers: Headers, cookie: string) {
  headers.append("Set-Cookie", cookie)
}

export function clearSessionCookies(headers: Headers, env: AuthEnv) {
  appendCookie(
    headers,
    serializeCookie(SESSION_COOKIE, "", { maxAge: 0, origin: env.appOrigin })
  )
  appendCookie(
    headers,
    serializeCookie(OAUTH_COOKIE, "", { maxAge: 0, origin: env.appOrigin })
  )
}

export function cookieHeaderFromMap(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("; ")
}
