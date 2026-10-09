import { createHash, timingSafeEqual } from "node:crypto"

import type { AuthEnv } from "./config.ts"
import { allowedRequestOrigins } from "./origin.ts"

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
export const GOOGLE_ISSUERS = [
  "https://accounts.google.com",
  "accounts.google.com",
] as const
export const OAUTH_SCOPES = "openid email profile"

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Buffer.from(buf).toString("base64url")
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) {
    const dummy = Buffer.alloc(a.length)
    timingSafeEqual(a, dummy)
    return false
  }
  return timingSafeEqual(a, b)
}

export function googleAuthorizationUrl(
  env: AuthEnv,
  input: { state: string; nonce: string; codeChallenge: string }
): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set("client_id", env.googleClientId)
  url.searchParams.set("redirect_uri", env.googleRedirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", OAUTH_SCOPES)
  url.searchParams.set("state", input.state)
  url.searchParams.set("nonce", input.nonce)
  url.searchParams.set("code_challenge", input.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("include_granted_scopes", "false")
  return url.toString()
}

export function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin")
  if (origin) {
    return origin.replace(/\/$/, "")
  }
  const referer = request.headers.get("referer")
  if (!referer) {
    return null
  }
  try {
    return new URL(referer).origin
  } catch {
    return null
  }
}

export function originAllowed(origin: string | null, appOrigin: string): boolean {
  if (!origin) {
    return false
  }
  try {
    return allowedRequestOrigins(appOrigin).includes(origin.replace(/\/$/, ""))
  } catch {
    return false
  }
}
