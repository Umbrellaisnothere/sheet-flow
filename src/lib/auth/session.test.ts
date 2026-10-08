import assert from "node:assert/strict"
import test from "node:test"

import { sealSession, unsealSession } from "./session.ts"

const SECRET = "test-session-secret-which-is-32b+"

test("session: round-trips sub and email", async () => {
  const token = await sealSession(SECRET, {
    sub: "google-sub-1",
    email: "user@example.com",
  })
  const payload = await unsealSession(SECRET, token)
  assert.ok(payload)
  assert.equal(payload.sub, "google-sub-1")
  assert.equal(payload.email, "user@example.com")
  assert.ok(payload.exp > Date.now() / 1000)
})

test("session: expired token is rejected", async () => {
  const token = await sealSession(
    SECRET,
    { sub: "google-sub-1", email: "user@example.com" },
    1
  )
  const later = new Date(Date.now() + 5_000)
  const payload = await unsealSession(SECRET, token, later)
  assert.equal(payload, null)
})

test("session: invalid ciphertext is rejected", async () => {
  assert.equal(await unsealSession(SECRET, "not-a-token"), null)
  assert.equal(await unsealSession(SECRET, ""), null)
  assert.equal(await unsealSession("other-secret-which-is-32-bytes!!", await sealSession(SECRET, { sub: "s", email: "a@b.c" })), null)
})
