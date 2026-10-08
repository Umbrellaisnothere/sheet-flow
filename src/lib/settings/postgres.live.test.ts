import assert from "node:assert/strict"
import test from "node:test"

import { loadLocalEnv } from "../../../scripts/load-local-env.mjs"
import {
  handleGetSettings,
  handleGoogleCallback,
  handleGoogleStart,
  handleLogout,
  handlePutSettings,
  handleSession,
} from "../auth/handlers.ts"
import { cookieHeaderFromMap, cookiesFromResponse } from "../auth/cookies.ts"
import { SESSION_COOKIE } from "../auth/config.ts"
import type { GoogleClient, GoogleIdentity } from "../auth/google.ts"
import { createPostgresStore } from "./postgres-store.ts"
import postgres from "postgres"

loadLocalEnv()

const ORIGIN = "http://127.0.0.1:43173"
const databaseUrl = process.env.DATABASE_URL?.trim() ?? ""
const sessionSecret =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32
    ? process.env.SESSION_SECRET
    : "phase3-live-session-secret-32bytes+"
const live = Boolean(databaseUrl)

function env() {
  return {
    googleClientId: "phase3-local-client.apps.googleusercontent.com",
    googleClientSecret: "phase3-local-not-a-real-google-secret",
    googleRedirectUri: `${ORIGIN}/api/auth/google/callback`,
    sessionSecret,
    appOrigin: ORIGIN,
  }
}

function fakeGoogle(identity: GoogleIdentity): GoogleClient {
  return {
    async exchangeAuthorizationCode() {
      return { idToken: "phase3-id-token" }
    },
    async verifyIdToken() {
      return identity
    },
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

async function signIn(
  store: ReturnType<typeof createPostgresStore>,
  identity: GoogleIdentity
) {
  const google = fakeGoogle(identity)
  const deps = { env: env(), store, google }
  const start = await handleGoogleStart(request("/api/auth/google"), deps)
  const pending = cookiesFromResponse(start)
  const state = new URL(start.headers.get("location") ?? "").searchParams.get(
    "state"
  )
  const callback = await handleGoogleCallback(
    request(`/api/auth/google/callback?code=ok&state=${state}`, {
      cookies: pending,
    }),
    deps
  )
  return { start, callback, cookies: cookiesFromResponse(callback) }
}

test("live postgres: schema has users and highlight_settings", { skip: !live }, async () => {
  const sql = postgres(databaseUrl, { max: 1 })
  try {
    const rows = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('users', 'highlight_settings')
      ORDER BY tablename
    `
    assert.deepEqual(
      rows.map((row) => row.tablename),
      ["highlight_settings", "users"]
    )
  } finally {
    await sql.end({ timeout: 5 })
  }
})

test("live postgres: first login creates user and default settings", { skip: !live }, async () => {
  const store = createPostgresStore(databaseUrl)
  const identity = {
    sub: "phase3-sub-default",
    email: "phase3-default@example.com",
  }
  const { callback, cookies } = await signIn(store, identity)
  assert.equal(callback.status, 302)
  const setCookie = callback.headers.getSetCookie().join("\n")
  assert.match(setCookie, /fc_session=/)
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Lax/)
  assert.doesNotMatch(setCookie, /phase3-id-token/)
  assert.doesNotMatch(setCookie, /access_token|refresh_token/i)
  if (ORIGIN.startsWith("https://")) {
    assert.match(setCookie, /Secure/)
  } else {
    assert.doesNotMatch(
      setCookie.split("\n").find((line) => line.startsWith("fc_session=")) ?? "",
      /;\s*Secure/
    )
  }
  const settings = await handleGetSettings(
    request("/api/settings", { cookies }),
    { env: env(), store }
  )
  assert.equal(settings.status, 200)
  const body = await settings.json()
  assert.equal(body.color, "#1a73e8")
  assert.equal(body.opacity, "0.1")
  assert.match(body.updatedAt, /Z$/)
})

test("live postgres: email change keeps the same sub", { skip: !live }, async () => {
  const store = createPostgresStore(databaseUrl)
  await store.upsertUserBySub("phase3-sub-email", "phase3-old@example.com")
  await store.upsertUserBySub("phase3-sub-email", "phase3-new@example.com")
  const user = await store.getUserBySub("phase3-sub-email")
  assert.equal(user?.googleSub, "phase3-sub-email")
  assert.equal(user?.email, "phase3-new@example.com")
  const other = await store.getUserBySub("phase3-new@example.com")
  assert.equal(other, null)
})

test("live postgres: accounts are isolated by sub", { skip: !live }, async () => {
  const store = createPostgresStore(databaseUrl)
  const a = await signIn(store, { sub: "phase3-sub-a", email: "phase3-a@example.com" })
  const b = await signIn(store, { sub: "phase3-sub-b", email: "phase3-b@example.com" })
  const putA = await handlePutSettings(
    request("/api/settings", {
      method: "PUT",
      origin: ORIGIN,
      cookies: a.cookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ color: "#217346", opacity: "0.2" }),
    }),
    { env: env(), store }
  )
  assert.equal(putA.status, 200)
  const getB = await handleGetSettings(
    request("/api/settings", { cookies: b.cookies }),
    { env: env(), store }
  )
  const bodyB = await getB.json()
  assert.equal(bodyB.color, "#1a73e8")
  const storedA = await store.getSettings("phase3-sub-a")
  const storedB = await store.getSettings("phase3-sub-b")
  assert.equal(storedA?.color, "#217346")
  assert.equal(storedB?.color, "#1a73e8")
})

test("live postgres: PUT persists and GET after a new connection", { skip: !live }, async () => {
  const store = createPostgresStore(databaseUrl)
  const { cookies } = await signIn(store, {
    sub: "phase3-sub-a",
    email: "phase3-a@example.com",
  })
  const put = await handlePutSettings(
    request("/api/settings", {
      method: "PUT",
      origin: ORIGIN,
      cookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ color: "#abc", opacity: "0.25" }),
    }),
    { env: env(), store }
  )
  assert.equal(put.status, 200)
  const saved = await put.json()
  assert.equal(saved.color, "#aabbcc")
  assert.equal(saved.opacity, "0.25")
  assert.ok(saved.updatedAt)

  const storeAfterRestart = createPostgresStore(databaseUrl)
  const again = await storeAfterRestart.getSettings("phase3-sub-a")
  assert.equal(again?.color, "#aabbcc")
  assert.equal(again?.opacity, "0.25")
})

test("live postgres: invalid values return 400 and are not stored", { skip: !live }, async () => {
  const store = createPostgresStore(databaseUrl)
  const { cookies } = await signIn(store, {
    sub: "phase3-sub-a",
    email: "phase3-a@example.com",
  })
  const before = await store.getSettings("phase3-sub-a")
  const invalid = [
    { color: "#abcd", opacity: "0.1" },
    { color: "#abcdefg", opacity: "0.1" },
    { color: "red", opacity: "0.1" },
    { color: "rgb(1,2,3)", opacity: "0.1" },
    { color: "javascript:alert(1)", opacity: "0.1" },
    { color: "#1a73e8", opacity: "0.04" },
    { color: "#1a73e8", opacity: "0.51" },
    { color: "#1a73e8", opacity: "abc" },
    { color: "#1a73e8", opacity: null },
  ]
  for (const body of invalid) {
    const response = await handlePutSettings(
      request("/api/settings", {
        method: "PUT",
        origin: ORIGIN,
        cookies,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { env: env(), store }
    )
    assert.equal(response.status, 400, JSON.stringify(body))
  }
  const after = await store.getSettings("phase3-sub-a")
  assert.equal(after?.color, before?.color)
  assert.equal(after?.opacity, before?.opacity)
  assert.equal(after?.updatedAt, before?.updatedAt)
})

test("live postgres: valid colour and opacity forms persist", { skip: !live }, async () => {
  const store = createPostgresStore(databaseUrl)
  const { cookies } = await signIn(store, {
    sub: "phase3-sub-a",
    email: "phase3-a@example.com",
  })
  const cases = [
    { color: "#abc", opacity: "0.05", colorOut: "#aabbcc", opacityOut: "0.05" },
    { color: "#abcdef", opacity: "0.1", colorOut: "#abcdef", opacityOut: "0.1" },
    { color: "#1a73e8", opacity: "0.25", colorOut: "#1a73e8", opacityOut: "0.25" },
    { color: "#000", opacity: "0.5", colorOut: "#000000", opacityOut: "0.5" },
  ]
  for (const item of cases) {
    const response = await handlePutSettings(
      request("/api/settings", {
        method: "PUT",
        origin: ORIGIN,
        cookies,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ color: item.color, opacity: item.opacity }),
      }),
      { env: env(), store }
    )
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.color, item.colorOut)
    assert.equal(body.opacity, item.opacityOut)
  }
})

test("live postgres: stale baseUpdatedAt returns 409", { skip: !live }, async () => {
  const store = createPostgresStore(databaseUrl)
  const { cookies } = await signIn(store, {
    sub: "phase3-sub-a",
    email: "phase3-a@example.com",
  })
  const first = await handleGetSettings(
    request("/api/settings", { cookies }),
    { env: env(), store }
  )
  const original = await first.json()
  const update = await handlePutSettings(
    request("/api/settings", {
      method: "PUT",
      origin: ORIGIN,
      cookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        color: "#ffffff",
        opacity: "0.3",
        baseUpdatedAt: original.updatedAt,
      }),
    }),
    { env: env(), store }
  )
  assert.equal(update.status, 200)
  const newer = await update.json()
  const stale = await handlePutSettings(
    request("/api/settings", {
      method: "PUT",
      origin: ORIGIN,
      cookies,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        color: "#000000",
        opacity: "0.4",
        baseUpdatedAt: original.updatedAt,
      }),
    }),
    { env: env(), store }
  )
  assert.equal(stale.status, 409)
  const conflict = await stale.json()
  assert.equal(conflict.settings.color, "#ffffff")
  assert.equal(conflict.settings.updatedAt, newer.updatedAt)
  const stored = await store.getSettings("phase3-sub-a")
  assert.equal(stored?.color, "#ffffff")
})

test("live postgres: logout invalidates the application session", { skip: !live }, async () => {
  const store = createPostgresStore(databaseUrl)
  const { cookies } = await signIn(store, {
    sub: "phase3-sub-a",
    email: "phase3-a@example.com",
  })
  const before = await handleSession(
    request("/api/auth/session", { cookies }),
    { env: env(), store }
  )
  const beforeBody = await before.json()
  assert.equal(beforeBody.authenticated, true)
  const logout = await handleLogout(
    request("/api/auth/logout", { method: "POST", cookies, origin: ORIGIN }),
    { env: env(), store }
  )
  assert.equal(logout.status, 200)
  const cleared = cookiesFromResponse(logout)
  assert.equal(cleared[SESSION_COOKIE], "")
  const after = await handleSession(
    request("/api/auth/session", { cookies: { [SESSION_COOKIE]: "" } }),
    { env: env(), store }
  )
  assert.deepEqual(await after.json(), { authenticated: false })
  const settings = await handleGetSettings(
    request("/api/settings", { cookies: { [SESSION_COOKIE]: "" } }),
    { env: env(), store }
  )
  assert.equal(settings.status, 401)
})

test("live postgres: OAuth next rejects open redirects", { skip: !live }, async () => {
  const store = createPostgresStore(databaseUrl)
  const identity = { sub: "phase3-sub-a", email: "phase3-a@example.com" }
  for (const next of ["https://evil.example", "//evil.example", "/%2F%2Fevil.example"]) {
    const google = fakeGoogle(identity)
    const deps = { env: env(), store, google }
    const start = await handleGoogleStart(
      request(`/api/auth/google?next=${encodeURIComponent(next)}`),
      deps
    )
    const pending = cookiesFromResponse(start)
    const state = new URL(start.headers.get("location") ?? "").searchParams.get(
      "state"
    )
    const callback = await handleGoogleCallback(
      request(`/api/auth/google/callback?code=ok&state=${state}`, {
        cookies: pending,
      }),
      deps
    )
    const location = callback.headers.get("location") ?? ""
    assert.equal(new URL(location).origin, ORIGIN, next)
    assert.doesNotMatch(location, /^https?:\/\/evil\.example/)
    assert.doesNotMatch(location, /^\/\/evil\.example/)
  }
  const google = fakeGoogle(identity)
  const deps = { env: env(), store, google }
  const start = await handleGoogleStart(
    request("/api/auth/google?next=/instant"),
    deps
  )
  const pending = cookiesFromResponse(start)
  const state = new URL(start.headers.get("location") ?? "").searchParams.get(
    "state"
  )
  const callback = await handleGoogleCallback(
    request(`/api/auth/google/callback?code=ok&state=${state}`, {
      cookies: pending,
    }),
    deps
  )
  assert.match(callback.headers.get("location") ?? "", /^http:\/\/127\.0\.0\.1:43173\/instant/)
})
