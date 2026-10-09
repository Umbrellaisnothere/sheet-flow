import {
  OAUTH_COOKIE,
  OAUTH_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  SYNC_REQUEST_MAX_AGE_SECONDS,
  SYNC_TOKEN_MAX_AGE_SECONDS,
  envIsConfigured,
  readAuthEnv,
  type AuthEnv,
} from "./config.ts"
import {
  appendCookie,
  clearSessionCookies,
  parseCookies,
  serializeCookie,
} from "./cookies.ts"
import { createGoogleClient, type GoogleClient } from "./google.ts"
import {
  googleAuthorizationUrl,
  originAllowed,
  pkceChallenge,
  randomToken,
  requestOrigin,
  safeEqual,
  sha256Hex,
} from "./oauth.ts"
import { sealOAuth, sealSession, unsealOAuth, unsealSession } from "./session.ts"
import { safeNextPath } from "./safe-path.ts"
import { htmlMessage, json, jsonError, redirectTo } from "../http.ts"
import { getAccountStore } from "../settings/get-store.ts"
import {
  parseApiColor,
  parseApiOpacity,
} from "../settings/validate.ts"
import type { AccountStore } from "../settings/store.ts"

export type HandlerDeps = {
  env?: Partial<AuthEnv>
  store?: AccountStore | null
  google?: GoogleClient
  now?: () => Date
}

const AUTH_QUERY = new Set([
  "ok",
  "error",
  "denied",
  "invalid",
  "expired",
  "not_configured",
])

function resolve(deps: HandlerDeps): {
  env: AuthEnv
  store: AccountStore | null
  google: GoogleClient
  now: () => Date
} {
  const env = readAuthEnv(deps.env)
  const store = deps.store === undefined ? getAccountStore() : deps.store
  const now = deps.now ?? (() => new Date())
  const google = deps.google ?? createGoogleClient(env, { now })
  return { env, store, google, now }
}

function appRedirect(
  env: AuthEnv,
  next: string,
  auth?: string,
  extra?: Headers
): Response {
  const url = new URL(safeNextPath(next, "/"), env.appOrigin)
  if (auth && AUTH_QUERY.has(auth)) {
    url.searchParams.set("auth", auth)
  }
  return redirectTo(url.toString(), extra)
}

function parseBearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization")
  if (!header) {
    return undefined
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1]
}

async function identityFromRequest(
  request: Request,
  env: AuthEnv,
  store: AccountStore | null,
  now: Date
): Promise<{ sub: string; email: string; via: "cookie" | "bearer" } | null> {
  const bearer = parseBearerToken(request)
  if (bearer && store) {
    const row = await store.getSyncToken(sha256Hex(bearer), now)
    if (row) {
      return { sub: row.googleSub, email: row.email, via: "bearer" }
    }
  }
  const cookies = parseCookies(request.headers.get("cookie"))
  const session = await unsealSession(env.sessionSecret, cookies[SESSION_COOKIE], now)
  if (!session) {
    return null
  }
  return { sub: session.sub, email: session.email, via: "cookie" }
}

function requireConfigured(
  env: AuthEnv,
  store: AccountStore | null,
  asHtml: boolean
): Response | null {
  if (envIsConfigured(env, Boolean(store))) {
    return null
  }
  if (asHtml) {
    const headers = new Headers()
    if (env.appOrigin) {
      clearSessionCookies(headers, env)
    }
    return htmlMessage(
      "Sign-in is not configured",
      "Google sign-in is not configured on this server. The highlighter still works without an account.",
      503,
      headers
    )
  }
  return jsonError(503, "not_configured")
}

export async function handleGoogleStart(
  request: Request,
  deps: HandlerDeps = {}
): Promise<Response> {
  const { env, store, now } = resolve(deps)
  const blocked = requireConfigured(env, store, true)
  if (blocked) {
    return blocked
  }
  if (!store) {
    return htmlMessage(
      "Sign-in is not configured",
      "This server cannot create a sign-in session.",
      503
    )
  }
  const url = new URL(request.url)
  const next = safeNextPath(url.searchParams.get("next"))
  const state = randomToken()
  const nonce = randomToken()
  const codeVerifier = randomToken()
  const codeChallenge = pkceChallenge(codeVerifier)
  const pending = { state, nonce, codeVerifier, next }
  let sealed: string
  try {
    sealed = await sealOAuth(env.sessionSecret, pending, OAUTH_MAX_AGE_SECONDS)
    await store.saveOAuthPending(
      pending,
      new Date(now().getTime() + OAUTH_MAX_AGE_SECONDS * 1000)
    )
  } catch {
    return htmlMessage(
      "Sign-in is not configured",
      "This server cannot create a sign-in session.",
      503
    )
  }
  const headers = new Headers()
  appendCookie(
    headers,
    serializeCookie(OAUTH_COOKIE, sealed, {
      maxAge: OAUTH_MAX_AGE_SECONDS,
      origin: env.appOrigin,
    })
  )
  return redirectTo(
    googleAuthorizationUrl(env, { state, nonce, codeChallenge }),
    headers
  )
}

export async function handleGoogleCallback(
  request: Request,
  deps: HandlerDeps = {}
): Promise<Response> {
  const { env, store, google, now } = resolve(deps)
  const blocked = requireConfigured(env, store, true)
  if (blocked) {
    return blocked
  }
  if (!store) {
    return appRedirect(env, "/", "not_configured")
  }

  const url = new URL(request.url)
  const cookies = parseCookies(request.headers.get("cookie"))
  const fromCookie = await unsealOAuth(
    env.sessionSecret,
    cookies[OAUTH_COOKIE],
    now()
  )
  const stateParam = url.searchParams.get("state")
  let pending = fromCookie
  if (fromCookie) {
    await store.takeOAuthPending(fromCookie.state, now())
  } else if (stateParam) {
    pending = await store.takeOAuthPending(stateParam, now())
  }
  const clearHeaders = new Headers()
  appendCookie(
    clearHeaders,
    serializeCookie(OAUTH_COOKIE, "", {
      maxAge: 0,
      origin: env.appOrigin,
    })
  )

  const googleError = url.searchParams.get("error")
  if (googleError === "access_denied") {
    return appRedirect(env, pending?.next ?? "/", "denied", clearHeaders)
  }
  if (googleError) {
    return appRedirect(env, pending?.next ?? "/", "error", clearHeaders)
  }

  if (!pending) {
    return appRedirect(env, "/", "expired", clearHeaders)
  }

  const state = url.searchParams.get("state")
  const code = url.searchParams.get("code")
  if (!state || !safeEqual(state, pending.state)) {
    return appRedirect(env, pending.next, "invalid", clearHeaders)
  }
  if (!code || code.length > 2048) {
    return appRedirect(env, pending.next, "invalid", clearHeaders)
  }

  const token = await google.exchangeAuthorizationCode({
    code,
    codeVerifier: pending.codeVerifier,
    redirectUri: env.googleRedirectUri,
  })
  if ("error" in token) {
    return appRedirect(env, pending.next, "error", clearHeaders)
  }

  let identity
  try {
    identity = await google.verifyIdToken(token.idToken, pending.nonce)
  } catch {
    return appRedirect(env, pending.next, "invalid", clearHeaders)
  }

  try {
    await store.upsertUserBySub(identity.sub, identity.email)
    await store.ensureDefaultSettings(identity.sub)
  } catch {
    return appRedirect(env, pending.next, "error", clearHeaders)
  }

  let sessionToken: string
  try {
    sessionToken = await sealSession(
      env.sessionSecret,
      { sub: identity.sub, email: identity.email },
      SESSION_MAX_AGE_SECONDS
    )
  } catch {
    return appRedirect(env, pending.next, "error", clearHeaders)
  }

  appendCookie(
    clearHeaders,
    serializeCookie(SESSION_COOKIE, sessionToken, {
      maxAge: SESSION_MAX_AGE_SECONDS,
      origin: env.appOrigin,
    })
  )
  return appRedirect(env, pending.next, "ok", clearHeaders)
}

export async function handleLogout(
  request: Request,
  deps: HandlerDeps = {}
): Promise<Response> {
  const { env, store, now } = resolve(deps)
  if (request.method !== "POST") {
    return jsonError(405, "method_not_allowed")
  }
  const origin = requestOrigin(request)
  if (!originAllowed(origin, env.appOrigin)) {
    return jsonError(403, "forbidden")
  }
  const cookies = parseCookies(request.headers.get("cookie"))
  const session = await unsealSession(
    env.sessionSecret,
    cookies[SESSION_COOKIE],
    now()
  )
  if (session && store) {
    try {
      await store.deleteSyncTokensForSub(session.sub)
    } catch {
      // Cookie still clears; highlighter falls back to local settings.
    }
  }
  const headers = new Headers()
  clearSessionCookies(headers, env)
  return json({ ok: true }, 200, headers)
}

export async function handleSession(
  request: Request,
  deps: HandlerDeps = {}
): Promise<Response> {
  const { env, store, now } = resolve(deps)
  const blocked = requireConfigured(env, store, false)
  if (blocked) {
    return blocked
  }
  const identity = await identityFromRequest(request, env, store, now())
  if (!identity) {
    return json({ authenticated: false })
  }
  return json({
    authenticated: true,
    email: identity.email,
  })
}

export async function handleGetSettings(
  request: Request,
  deps: HandlerDeps = {}
): Promise<Response> {
  const { env, store, now } = resolve(deps)
  const blocked = requireConfigured(env, store, false)
  if (blocked) {
    return blocked
  }
  if (!store) {
    return jsonError(503, "not_configured")
  }
  const identity = await identityFromRequest(request, env, store, now())
  if (!identity) {
    return jsonError(401, "unauthenticated")
  }
  try {
    let settings = await store.getSettings(identity.sub)
    if (!settings) {
      await store.upsertUserBySub(identity.sub, identity.email)
      settings = await store.ensureDefaultSettings(identity.sub)
    }
    return json({
      color: settings.color,
      opacity: settings.opacity,
      updatedAt: settings.updatedAt,
    })
  } catch {
    return jsonError(503, "unavailable")
  }
}

export async function handlePutSettings(
  request: Request,
  deps: HandlerDeps = {}
): Promise<Response> {
  const { env, store, now } = resolve(deps)
  const blocked = requireConfigured(env, store, false)
  if (blocked) {
    return blocked
  }
  if (!store) {
    return jsonError(503, "not_configured")
  }
  const identity = await identityFromRequest(request, env, store, now())
  if (!identity) {
    return jsonError(401, "unauthenticated")
  }
  if (identity.via === "cookie") {
    const origin = requestOrigin(request)
    if (!originAllowed(origin, env.appOrigin)) {
      return jsonError(403, "forbidden")
    }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, "invalid")
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "invalid")
  }
  const payload = body as Record<string, unknown>
  const color = parseApiColor(payload.color)
  const opacity = parseApiOpacity(payload.opacity)
  if (!color || !opacity) {
    return jsonError(400, "invalid")
  }
  let baseUpdatedAt: string | undefined
  if ("baseUpdatedAt" in payload) {
    if (
      typeof payload.baseUpdatedAt !== "string" ||
      !Number.isFinite(Date.parse(payload.baseUpdatedAt))
    ) {
      return jsonError(400, "invalid")
    }
    baseUpdatedAt = payload.baseUpdatedAt
  }

  try {
    let existing = await store.getSettings(identity.sub)
    if (!existing) {
      await store.upsertUserBySub(identity.sub, identity.email)
      existing = await store.ensureDefaultSettings(identity.sub)
    }
    const result = await store.updateSettings(
      identity.sub,
      color,
      opacity,
      baseUpdatedAt
    )
    if (!result.ok && result.reason === "conflict") {
      return json(
        {
          error: "conflict",
          settings: {
            color: result.settings.color,
            opacity: result.settings.opacity,
            updatedAt: result.settings.updatedAt,
          },
        },
        409
      )
    }
    if (!result.ok) {
      return jsonError(503, "unavailable")
    }
    return json({
      color: result.settings.color,
      opacity: result.settings.opacity,
      updatedAt: result.settings.updatedAt,
    })
  } catch {
    return jsonError(503, "unavailable")
  }
}

export async function handleSyncPrepare(
  request: Request,
  deps: HandlerDeps = {}
): Promise<Response> {
  const { env, store, now } = resolve(deps)
  const blocked = requireConfigured(env, store, false)
  if (blocked) {
    return blocked
  }
  if (!store) {
    return jsonError(503, "not_configured")
  }
  if (request.method !== "POST") {
    return jsonError(405, "method_not_allowed")
  }
  const requestId = randomToken(18)
  const pollSecret = randomToken()
  const expiresAt = new Date(now().getTime() + SYNC_REQUEST_MAX_AGE_SECONDS * 1000)
  try {
    await store.createSyncRequest({
      requestId,
      pollSecretHash: sha256Hex(pollSecret),
      expiresAt,
    })
  } catch {
    return jsonError(503, "unavailable")
  }
  return json({
    requestId,
    pollSecret,
    authorizePath: `/sync?request=${encodeURIComponent(requestId)}`,
  })
}

export async function handleSyncPoll(
  request: Request,
  deps: HandlerDeps = {}
): Promise<Response> {
  const { env, store, now } = resolve(deps)
  const blocked = requireConfigured(env, store, false)
  if (blocked) {
    return blocked
  }
  if (!store) {
    return jsonError(503, "not_configured")
  }
  if (request.method !== "POST") {
    return jsonError(405, "method_not_allowed")
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, "invalid")
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "invalid")
  }
  const payload = body as Record<string, unknown>
  if (
    typeof payload.requestId !== "string" ||
    !payload.requestId ||
    typeof payload.pollSecret !== "string" ||
    !payload.pollSecret
  ) {
    return jsonError(400, "invalid")
  }
  try {
    const result = await store.pollSyncRequest({
      requestId: payload.requestId,
      pollSecretHash: sha256Hex(payload.pollSecret),
      now: now(),
    })
    if (result.status === "missing") {
      return json({ status: "expired" }, 404)
    }
    if (result.status === "pending") {
      return json({ status: "pending" })
    }
    return json({
      status: "ready",
      token: result.token,
      email: result.email,
      expiresAt: result.expiresAt,
    })
  } catch {
    return jsonError(503, "unavailable")
  }
}

export async function handleSyncApprove(
  request: Request,
  deps: HandlerDeps = {}
): Promise<Response> {
  const { env, store, now } = resolve(deps)
  const blocked = requireConfigured(env, store, false)
  if (blocked) {
    return blocked
  }
  if (!store) {
    return jsonError(503, "not_configured")
  }
  if (request.method !== "POST") {
    return jsonError(405, "method_not_allowed")
  }
  const origin = requestOrigin(request)
  if (!originAllowed(origin, env.appOrigin)) {
    return jsonError(403, "forbidden")
  }
  const cookies = parseCookies(request.headers.get("cookie"))
  const session = await unsealSession(
    env.sessionSecret,
    cookies[SESSION_COOKIE],
    now()
  )
  if (!session) {
    return jsonError(401, "unauthenticated")
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, "invalid")
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "invalid")
  }
  const payload = body as Record<string, unknown>
  if (typeof payload.requestId !== "string" || !payload.requestId) {
    return jsonError(400, "invalid")
  }
  const issuedToken = `fcs_${randomToken()}`
  const tokenExpiresAt = new Date(
    now().getTime() + SYNC_TOKEN_MAX_AGE_SECONDS * 1000
  )
  try {
    await store.upsertUserBySub(session.sub, session.email)
    const ok = await store.approveSyncRequest({
      requestId: payload.requestId,
      googleSub: session.sub,
      email: session.email,
      issuedToken,
      tokenHash: sha256Hex(issuedToken),
      tokenExpiresAt,
      now: now(),
    })
    if (!ok) {
      return jsonError(404, "expired")
    }
  } catch {
    return jsonError(503, "unavailable")
  }
  return json({ ok: true })
}
