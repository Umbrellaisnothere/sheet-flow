import assert from "node:assert/strict"
import test from "node:test"

import {
  handleGetSettings,
  handleGoogleCallback,
  handleGoogleStart,
  handleLogout,
  handlePutSettings,
  handleSession,
  type HandlerDeps,
} from "./handlers.ts"
import { cookieHeaderFromMap, cookiesFromResponse } from "./cookies.ts"
import { SESSION_COOKIE } from "./config.ts"
import { OAUTH_SCOPES } from "./oauth.ts"
import { sealSession } from "./session.ts"
import { createMemoryStore } from "../settings/memory-store.ts"
import type { GoogleClient, GoogleIdentity } from "./google.ts"

const ORIGIN = "http://127.0.0.1:43173"
const SECRET = "test-session-secret-which-is-32b+"

function testEnv() {
  return {
    googleClientId: "test-client-id.apps.googleusercontent.com",
    googleClientSecret: "test-google-client-secret",
    googleRedirectUri: `${ORIGIN}/api/auth/google/callback`,
    sessionSecret: SECRET,
    appOrigin: ORIGIN,
  }
}

function fakeGoogle(
  identity: GoogleIdentity,
  options: { failExchange?: boolean; failVerify?: boolean } = {}
): GoogleClient & { captured: { code?: string; verifier?: string; nonce?: string } } {
  const captured: { code?: string; verifier?: string; nonce?: string } = {}
  return {
    captured,
    async exchangeAuthorizationCode(input) {
      captured.code = input.code
      captured.verifier = input.codeVerifier
      if (options.failExchange) {
        return { error: "invalid_grant" }
      }
      return { idToken: "fake-id-token" }
    },
    async verifyIdToken(_idToken, nonce) {
      captured.nonce = nonce
      if (options.failVerify) {
        throw new Error("invalid_token")
      }
      return identity
    },
  }
}

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    env: testEnv(),
    store: createMemoryStore(),
    google: fakeGoogle({ sub: "sub-a", email: "a@example.com" }),
    ...overrides,
  }
}

function request(
  path: string,
  init: RequestInit & { cookies?: Record<string, string>; origin?: string } = {}
) {
  const headers = new Headers(init.headers)
  if (init.cookies) {
    headers.set("cookie", cookieHeaderFromMap(init.cookies))
  }
  if (init.origin) {
    headers.set("origin", init.origin)
  }
  return new Request(`${ORIGIN}${path}`, { ...init, headers })
}

async function sessionCookie(
  sub: string,
  email: string,
  lifetime = 7 * 24 * 60 * 60
) {
  return sealSession(SECRET, { sub, email }, lifetime)
}

async function authed(
  store = createMemoryStore(),
  identity: GoogleIdentity = { sub: "sub-a", email: "a@example.com" }
) {
  await store.upsertUserBySub(identity.sub, identity.email)
  await store.ensureDefaultSettings(identity.sub)
  const cookie = await sessionCookie(identity.sub, identity.email)
  return {
    store,
    cookies: { [SESSION_COOKIE]: cookie },
    identity,
  }
}

test("auth: unauthenticated GET /api/settings returns 401", async () => {
  const response = await handleGetSettings(request("/api/settings"), deps())
  assert.equal(response.status, 401)
  const body = await response.json()
  assert.equal(body.error, "unauthenticated")
})

test("auth: valid session can read settings", async () => {
  const { store, cookies } = await authed()
  const response = await handleGetSettings(
    request("/api/settings", { cookies }),
    deps({ store })
  )
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.color, "#1a73e8")
  assert.equal(body.opacity, "0.1")
  assert.equal(typeof body.updatedAt, "string")
})

test("auth: expired session is unauthenticated", async () => {
  const store = createMemoryStore()
  await store.upsertUserBySub("sub-a", "a@example.com")
  await store.ensureDefaultSettings("sub-a")
  const cookie = await sessionCookie("sub-a", "a@example.com", 1)
  const later = new Date(Date.now() + 5_000)
  const response = await handleGetSettings(
    request("/api/settings", { cookies: { [SESSION_COOKIE]: cookie } }),
    deps({ store, now: () => later })
  )
  assert.equal(response.status, 401)
})

test("auth: invalid session is unauthenticated", async () => {
  const response = await handleGetSettings(
    request("/api/settings", { cookies: { [SESSION_COOKIE]: "tampered" } }),
    deps()
  )
  assert.equal(response.status, 401)
})

test("auth: sign-out clears the session", async () => {
  const { store, cookies } = await authed()
  const logout = await handleLogout(
    request("/api/auth/logout", { method: "POST", cookies, origin: ORIGIN }),
    deps({ store })
  )
  assert.equal(logout.status, 200)
  const cleared = cookiesFromResponse(logout)
  assert.equal(cleared[SESSION_COOKIE], "")
  const session = await handleSession(
    request("/api/auth/session", { cookies: { [SESSION_COOKIE]: "" } }),
    deps({ store })
  )
  const body = await session.json()
  assert.equal(body.authenticated, false)
})

test("auth: session probe does not use 401 for visitors", async () => {
  const response = await handleSession(request("/api/auth/session"), deps())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { authenticated: false })
})

test("auth: session probe returns email for a valid cookie", async () => {
  const { store, cookies } = await authed()
  const response = await handleSession(
    request("/api/auth/session", { cookies }),
    deps({ store })
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    authenticated: true,
    email: "a@example.com",
  })
})

test("identity: lookup is by Google sub, not email", async () => {
  const store = createMemoryStore()
  await store.upsertUserBySub("sub-a", "old@example.com")
  const again = await store.upsertUserBySub("sub-a", "new@example.com")
  assert.equal(again.googleSub, "sub-a")
  assert.equal(again.email, "new@example.com")
  const found = await store.getUserBySub("sub-a")
  assert.equal(found?.email, "new@example.com")
})

test("identity: email change does not create a new account", async () => {
  const store = createMemoryStore()
  const google = fakeGoogle({ sub: "sub-a", email: "second@example.com" })
  const start = await handleGoogleStart(
    request("/api/auth/google"),
    deps({ store, google })
  )
  const pending = cookiesFromResponse(start)
  const location = start.headers.get("location") ?? ""
  const state = new URL(location).searchParams.get("state") ?? ""
  await store.upsertUserBySub("sub-a", "first@example.com")
  await store.ensureDefaultSettings("sub-a")
  await handleGoogleCallback(
    request(`/api/auth/google/callback?code=ok&state=${state}`, {
      cookies: pending,
    }),
    deps({ store, google })
  )
  const user = await store.getUserBySub("sub-a")
  assert.equal(user?.email, "second@example.com")
  const other = await store.getUserBySub("sub-b")
  assert.equal(other, null)
})

test("identity: different sub values remain separate accounts", async () => {
  const store = createMemoryStore()
  await store.upsertUserBySub("sub-a", "shared@example.com")
  await store.ensureDefaultSettings("sub-a")
  await store.upsertUserBySub("sub-b", "shared@example.com")
  await store.ensureDefaultSettings("sub-b")
  await store.updateSettings("sub-a", "#217346", "0.2")
  const a = await store.getSettings("sub-a")
  const b = await store.getSettings("sub-b")
  assert.equal(a?.color, "#217346")
  assert.equal(b?.color, "#1a73e8")
})

test("isolation: user A cannot read user B settings", async () => {
  const store = createMemoryStore()
  await store.upsertUserBySub("sub-a", "a@example.com")
  await store.ensureDefaultSettings("sub-a")
  await store.upsertUserBySub("sub-b", "b@example.com")
  await store.ensureDefaultSettings("sub-b")
  await store.updateSettings("sub-b", "#000000", "0.3")
  const cookie = await sessionCookie("sub-a", "a@example.com")
  const response = await handleGetSettings(
    request("/api/settings", { cookies: { [SESSION_COOKIE]: cookie } }),
    deps({ store })
  )
  const body = await response.json()
  assert.equal(body.color, "#1a73e8")
  assert.notEqual(body.color, "#000000")
})

test("isolation: user A cannot modify user B settings via body identifiers", async () => {
  const store = createMemoryStore()
  await store.upsertUserBySub("sub-a", "a@example.com")
  await store.ensureDefaultSettings("sub-a")
  await store.upsertUserBySub("sub-b", "b@example.com")
  await store.ensureDefaultSettings("sub-b")
  const cookie = await sessionCookie("sub-a", "a@example.com")
  const response = await handlePutSettings(
    request("/api/settings", {
      method: "PUT",
      origin: ORIGIN,
      cookies: { [SESSION_COOKIE]: cookie },
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        color: "#217346",
        opacity: "0.2",
        google_sub: "sub-b",
        sub: "sub-b",
        userId: "sub-b",
      }),
    }),
    deps({ store })
  )
  assert.equal(response.status, 200)
  const a = await store.getSettings("sub-a")
  const b = await store.getSettings("sub-b")
  assert.equal(a?.color, "#217346")
  assert.equal(b?.color, "#1a73e8")
})

test("api: PUT authenticated settings returns server updatedAt", async () => {
  const { store, cookies } = await authed()
  const response = await handlePutSettings(
    request("/api/settings", {
      method: "PUT",
      origin: ORIGIN,
      cookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ color: "#abc", opacity: "0.25" }),
    }),
    deps({ store })
  )
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.color, "#aabbcc")
  assert.equal(body.opacity, "0.25")
  assert.match(body.updatedAt, /Z$/)
})

test("api: invalid payload returns 400", async () => {
  const { store, cookies } = await authed()
  const response = await handlePutSettings(
    request("/api/settings", {
      method: "PUT",
      origin: ORIGIN,
      cookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ color: "red", opacity: "9" }),
    }),
    deps({ store })
  )
  assert.equal(response.status, 400)
})

test("api: unauthenticated PUT returns 401", async () => {
  const response = await handlePutSettings(
    request("/api/settings", {
      method: "PUT",
      origin: ORIGIN,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ color: "#1a73e8", opacity: "0.1" }),
    }),
    deps()
  )
  assert.equal(response.status, 401)
})

test("api: stale baseUpdatedAt returns 409", async () => {
  const { store, cookies } = await authed()
  const current = await store.getSettings("sub-a")
  assert.ok(current)
  const response = await handlePutSettings(
    request("/api/settings", {
      method: "PUT",
      origin: ORIGIN,
      cookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        color: "#217346",
        opacity: "0.2",
        baseUpdatedAt: "2000-01-01T00:00:00.000Z",
      }),
    }),
    deps({ store })
  )
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.error, "conflict")
  assert.equal(body.settings.color, current.color)
  assert.equal(body.settings.updatedAt, current.updatedAt)
})

test("api: PUT without Origin is forbidden", async () => {
  const { store, cookies } = await authed()
  const response = await handlePutSettings(
    request("/api/settings", {
      method: "PUT",
      cookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ color: "#1a73e8", opacity: "0.1" }),
    }),
    deps({ store })
  )
  assert.equal(response.status, 403)
})

test("oauth: start redirects to Google with PKCE and limited scopes", async () => {
  const response = await handleGoogleStart(request("/api/auth/google"), deps())
  assert.equal(response.status, 302)
  const location = response.headers.get("location") ?? ""
  const url = new URL(location)
  assert.equal(url.origin, "https://accounts.google.com")
  assert.equal(url.searchParams.get("response_type"), "code")
  assert.equal(url.searchParams.get("scope"), OAUTH_SCOPES)
  assert.equal(url.searchParams.get("code_challenge_method"), "S256")
  assert.ok(url.searchParams.get("code_challenge"))
  assert.ok(url.searchParams.get("state"))
  assert.ok(url.searchParams.get("nonce"))
  assert.equal(url.searchParams.has("access_type"), false)
  assert.doesNotMatch(location, /client_secret/)
  const setCookie = response.headers.getSetCookie().join("; ")
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Lax/)
})

test("oauth: missing state is rejected", async () => {
  const google = fakeGoogle({ sub: "sub-a", email: "a@example.com" })
  const start = await handleGoogleStart(request("/api/auth/google"), deps({ google }))
  const pending = cookiesFromResponse(start)
  const response = await handleGoogleCallback(
    request("/api/auth/google/callback?code=ok", { cookies: pending }),
    deps({ google })
  )
  assert.equal(response.status, 302)
  assert.match(response.headers.get("location") ?? "", /auth=invalid/)
  assert.equal(cookiesFromResponse(response)[SESSION_COOKIE], undefined)
})

test("oauth: mismatched state is rejected", async () => {
  const google = fakeGoogle({ sub: "sub-a", email: "a@example.com" })
  const start = await handleGoogleStart(request("/api/auth/google"), deps({ google }))
  const pending = cookiesFromResponse(start)
  const response = await handleGoogleCallback(
    request("/api/auth/google/callback?code=ok&state=attacker-state", {
      cookies: pending,
    }),
    deps({ google })
  )
  assert.match(response.headers.get("location") ?? "", /auth=invalid/)
})

test("oauth: invalid authorization code is rejected", async () => {
  const google = fakeGoogle(
    { sub: "sub-a", email: "a@example.com" },
    { failExchange: true }
  )
  const start = await handleGoogleStart(request("/api/auth/google"), deps({ google }))
  const pending = cookiesFromResponse(start)
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state")
  const response = await handleGoogleCallback(
    request(`/api/auth/google/callback?code=stolen&state=${state}`, {
      cookies: pending,
    }),
    deps({ google })
  )
  assert.match(response.headers.get("location") ?? "", /auth=error/)
})

test("oauth: invalid ID token is rejected", async () => {
  const google = fakeGoogle(
    { sub: "sub-a", email: "a@example.com" },
    { failVerify: true }
  )
  const start = await handleGoogleStart(request("/api/auth/google"), deps({ google }))
  const pending = cookiesFromResponse(start)
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state")
  const response = await handleGoogleCallback(
    request(`/api/auth/google/callback?code=ok&state=${state}`, {
      cookies: pending,
    }),
    deps({ google })
  )
  assert.match(response.headers.get("location") ?? "", /auth=invalid/)
})

test("oauth: callback creates session and default settings", async () => {
  const store = createMemoryStore()
  const google = fakeGoogle({ sub: "sub-a", email: "a@example.com" })
  const start = await handleGoogleStart(
    request("/api/auth/google?next=/instant"),
    deps({ store, google })
  )
  const pending = cookiesFromResponse(start)
  const authUrl = new URL(start.headers.get("location") ?? "")
  const response = await handleGoogleCallback(
    request(
      `/api/auth/google/callback?code=ok&state=${authUrl.searchParams.get("state")}`,
      { cookies: pending }
    ),
    deps({ store, google })
  )
  assert.equal(response.status, 302)
  const location = response.headers.get("location") ?? ""
  assert.equal(location.startsWith(`${ORIGIN}/instant`), true)
  assert.doesNotMatch(location, /https:\/\/evil/)
  const cookies = cookiesFromResponse(response)
  assert.ok(cookies[SESSION_COOKIE])
  const setCookie = response.headers.getSetCookie().join("\n")
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Lax/)
  assert.doesNotMatch(setCookie, /fake-id-token/)
  assert.doesNotMatch(setCookie, /test-google-client-secret/)
  const settings = await store.getSettings("sub-a")
  assert.equal(settings?.color, "#1a73e8")
  assert.equal(settings?.opacity, "0.1")
  assert.equal(google.captured.nonce, authUrl.searchParams.get("nonce"))
})

test("oauth: next cannot be an open redirect", async () => {
  const store = createMemoryStore()
  const google = fakeGoogle({ sub: "sub-a", email: "a@example.com" })
  const start = await handleGoogleStart(
    request("/api/auth/google?next=https://evil.example"),
    deps({ store, google })
  )
  const pending = cookiesFromResponse(start)
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state")
  const response = await handleGoogleCallback(
    request(`/api/auth/google/callback?code=ok&state=${state}`, {
      cookies: pending,
    }),
    deps({ store, google })
  )
  const location = response.headers.get("location") ?? ""
  assert.equal(location.startsWith(`${ORIGIN}/?`), true)
  assert.doesNotMatch(location, /evil\.example/)
})

test("oauth: protocol-relative next is rejected", async () => {
  const store = createMemoryStore()
  const google = fakeGoogle({ sub: "sub-a", email: "a@example.com" })
  const start = await handleGoogleStart(
    request("/api/auth/google?next=//evil.example"),
    deps({ store, google })
  )
  const pending = cookiesFromResponse(start)
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state")
  const response = await handleGoogleCallback(
    request(`/api/auth/google/callback?code=ok&state=${state}`, {
      cookies: pending,
    }),
    deps({ store, google })
  )
  assert.doesNotMatch(response.headers.get("location") ?? "", /evil/)
})

test("oauth: missing oauth cookie cannot complete login", async () => {
  const google = fakeGoogle({ sub: "sub-a", email: "a@example.com" })
  const response = await handleGoogleCallback(
    request("/api/auth/google/callback?code=ok&state=abc"),
    deps({ google })
  )
  assert.match(response.headers.get("location") ?? "", /auth=expired/)
})

test("oauth: start without credentials is not configured", async () => {
  const response = await handleGoogleStart(
    request("/api/auth/google"),
    deps({
      env: {
        googleClientId: "",
        googleClientSecret: "",
        googleRedirectUri: "",
        sessionSecret: "",
        appOrigin: ORIGIN,
      },
      store: null,
    })
  )
  assert.equal(response.status, 503)
})

test("oauth: callback replay without pending cookie fails", async () => {
  const store = createMemoryStore()
  const google = fakeGoogle({ sub: "sub-a", email: "a@example.com" })
  const start = await handleGoogleStart(request("/api/auth/google"), deps({ store, google }))
  const pending = cookiesFromResponse(start)
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state")
  const first = await handleGoogleCallback(
    request(`/api/auth/google/callback?code=ok&state=${state}`, {
      cookies: pending,
    }),
    deps({ store, google })
  )
  assert.ok(cookiesFromResponse(first)[SESSION_COOKIE])
  const second = await handleGoogleCallback(
    request(`/api/auth/google/callback?code=ok&state=${state}`),
    deps({ store, google })
  )
  assert.match(second.headers.get("location") ?? "", /auth=expired/)
})
