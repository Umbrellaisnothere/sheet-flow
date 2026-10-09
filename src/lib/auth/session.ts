import { EncryptJWT, jwtDecrypt, errors } from "jose"

import { SESSION_MAX_AGE_SECONDS } from "./config.ts"

export type SessionPayload = {
  sub: string
  email: string
  exp: number
}

type SealedSession = {
  purpose: "session"
  sub: string
  email: string
}

type SealedOAuth = {
  purpose: "oauth"
  state: string
  nonce: string
  codeVerifier: string
  next: string
}

export type OAuthPending = {
  state: string
  nonce: string
  codeVerifier: string
  next: string
}

async function derivedKey(secret: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  )
  return new Uint8Array(hash)
}

export async function sealSession(
  secret: string,
  payload: { sub: string; email: string },
  lifetimeSeconds = SESSION_MAX_AGE_SECONDS
): Promise<string> {
  const key = await derivedKey(secret)
  return new EncryptJWT({
    purpose: "session",
    sub: payload.sub,
    email: payload.email,
  } satisfies SealedSession)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${lifetimeSeconds}s`)
    .encrypt(key)
}

export async function unsealSession(
  secret: string,
  token: string | undefined,
  now = new Date()
): Promise<SessionPayload | null> {
  if (!token) {
    return null
  }
  try {
    const { payload } = await jwtDecrypt(token, await derivedKey(secret), {
      clockTolerance: 0,
      currentDate: now,
    })
    if (payload.purpose !== "session") {
      return null
    }
    if (typeof payload.sub !== "string" || !payload.sub) {
      return null
    }
    const exp = typeof payload.exp === "number" ? payload.exp : 0
    if (exp * 1000 <= now.getTime()) {
      return null
    }
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      exp,
    }
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      return null
    }
    return null
  }
}

export async function sealOAuth(
  secret: string,
  pending: OAuthPending,
  lifetimeSeconds: number
): Promise<string> {
  const key = await derivedKey(secret)
  return new EncryptJWT({
    purpose: "oauth",
    state: pending.state,
    nonce: pending.nonce,
    codeVerifier: pending.codeVerifier,
    next: pending.next,
  } satisfies SealedOAuth)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${lifetimeSeconds}s`)
    .encrypt(key)
}

export async function unsealOAuth(
  secret: string,
  token: string | undefined,
  now = new Date()
): Promise<OAuthPending | null> {
  if (!token) {
    return null
  }
  try {
    const { payload } = await jwtDecrypt(token, await derivedKey(secret), {
      clockTolerance: 0,
      currentDate: now,
    })
    if (payload.purpose !== "oauth") {
      return null
    }
    if (
      typeof payload.state !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.codeVerifier !== "string" ||
      typeof payload.next !== "string"
    ) {
      return null
    }
    return {
      state: payload.state,
      nonce: payload.nonce,
      codeVerifier: payload.codeVerifier,
      next: payload.next,
    }
  } catch {
    return null
  }
}
