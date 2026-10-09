import assert from "node:assert/strict"
import test from "node:test"

import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose"

import { verifyGoogleIdToken } from "./google.ts"

const CLIENT_ID = "test-google-client-id.apps.googleusercontent.com"

async function signer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  })
  const jwk = await exportJWK(publicKey)
  jwk.kid = "test-key"
  jwk.alg = "RS256"
  jwk.use = "sig"
  const jwks = createLocalJWKSet({ keys: [jwk] })
  async function sign(claims: Record<string, unknown>, extra?: { exp?: string; aud?: string; iss?: string }) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(extra?.iss ?? "https://accounts.google.com")
      .setAudience(extra?.aud ?? CLIENT_ID)
      .setSubject(typeof claims.sub === "string" ? claims.sub : "sub-1")
      .setIssuedAt()
      .setExpirationTime(extra?.exp ?? "5m")
      .sign(privateKey)
  }
  return { jwks, sign }
}

test("id token: valid token yields sub and email", async () => {
  const { jwks, sign } = await signer()
  const token = await sign({
    sub: "sub-1",
    email: "user@example.com",
    email_verified: true,
    nonce: "nonce-1",
  })
  const identity = await verifyGoogleIdToken(token, {
    clientId: CLIENT_ID,
    nonce: "nonce-1",
    jwks,
  })
  assert.equal(identity.sub, "sub-1")
  assert.equal(identity.email, "user@example.com")
})

test("id token: issuer mismatch is rejected", async () => {
  const { jwks, sign } = await signer()
  const token = await sign(
    { sub: "sub-1", email: "user@example.com", email_verified: true, nonce: "n" },
    { iss: "https://evil.example" }
  )
  await assert.rejects(() =>
    verifyGoogleIdToken(token, { clientId: CLIENT_ID, nonce: "n", jwks })
  )
})

test("id token: audience mismatch is rejected", async () => {
  const { jwks, sign } = await signer()
  const token = await sign(
    { sub: "sub-1", email: "user@example.com", email_verified: true, nonce: "n" },
    { aud: "other-client-id" }
  )
  await assert.rejects(() =>
    verifyGoogleIdToken(token, { clientId: CLIENT_ID, nonce: "n", jwks })
  )
})

test("id token: nonce mismatch is rejected", async () => {
  const { jwks, sign } = await signer()
  const token = await sign({
    sub: "sub-1",
    email: "user@example.com",
    email_verified: true,
    nonce: "expected",
  })
  await assert.rejects(() =>
    verifyGoogleIdToken(token, { clientId: CLIENT_ID, nonce: "other", jwks })
  )
})

test("id token: expired token is rejected", async () => {
  const { jwks, sign } = await signer()
  const token = await sign(
    { sub: "sub-1", email: "user@example.com", email_verified: true, nonce: "n" },
    { exp: "1s" }
  )
  const later = new Date(Date.now() + 5_000)
  await assert.rejects(() =>
    verifyGoogleIdToken(token, {
      clientId: CLIENT_ID,
      nonce: "n",
      jwks,
      now: later,
    })
  )
})
