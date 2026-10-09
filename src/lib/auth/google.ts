import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose"

import type { AuthEnv } from "./config.ts"
import {
  GOOGLE_ISSUERS,
  GOOGLE_JWKS_URL,
  GOOGLE_TOKEN_URL,
} from "./oauth.ts"

export type GoogleIdentity = {
  sub: string
  email: string
}

export type GoogleClient = {
  exchangeAuthorizationCode(input: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<{ idToken: string } | { error: string }>
  verifyIdToken(
    idToken: string,
    expectedNonce: string
  ): Promise<GoogleIdentity>
}

const remoteJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL))

export async function verifyGoogleIdToken(
  idToken: string,
  options: {
    clientId: string
    nonce: string
    jwks?: JWTVerifyGetKey
    now?: Date
  }
): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, options.jwks ?? remoteJwks, {
    issuer: [...GOOGLE_ISSUERS],
    audience: options.clientId,
    currentDate: options.now,
    clockTolerance: 0,
  })
  if (typeof payload.nonce !== "string" || payload.nonce !== options.nonce) {
    throw new Error("nonce_mismatch")
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("missing_sub")
  }
  const emailVerified = payload.email_verified === true
  const email =
    emailVerified && typeof payload.email === "string" ? payload.email : ""
  return { sub: payload.sub, email }
}

export async function exchangeGoogleCode(
  env: AuthEnv,
  input: { code: string; codeVerifier: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch
): Promise<{ idToken: string } | { error: string }> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code_verifier: input.codeVerifier,
  })
  let response: Response
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
    })
  } catch {
    return { error: "token_unavailable" }
  }
  let json: unknown
  try {
    json = await response.json()
  } catch {
    return { error: "token_invalid" }
  }
  if (!response.ok || !json || typeof json !== "object") {
    return { error: "invalid_grant" }
  }
  const idToken = (json as { id_token?: unknown }).id_token
  if (typeof idToken !== "string" || !idToken) {
    return { error: "missing_id_token" }
  }
  return { idToken }
}

export function createGoogleClient(
  env: AuthEnv,
  options: {
    fetchImpl?: typeof fetch
    jwks?: JWTVerifyGetKey
    now?: () => Date
  } = {}
): GoogleClient {
  return {
    async exchangeAuthorizationCode(input) {
      return exchangeGoogleCode(env, input, options.fetchImpl ?? fetch)
    },
    async verifyIdToken(idToken, expectedNonce) {
      return verifyGoogleIdToken(idToken, {
        clientId: env.googleClientId,
        nonce: expectedNonce,
        jwks: options.jwks,
        now: options.now?.(),
      })
    },
  }
}
