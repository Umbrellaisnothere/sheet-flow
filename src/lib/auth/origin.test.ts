import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  allowedRequestOrigins,
  bakeUserscriptSyncOrigin,
  LOCAL_DEV_ORIGIN,
  parseAppOrigin,
  resolveAppOrigin,
} from "./origin.ts"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const userscript = fs.readFileSync(
  path.join(root, "userscript", "sheets-focus-cell.user.js"),
  "utf8"
)

test("origin: localhost development URLs remain valid", () => {
  assert.equal(parseAppOrigin("http://127.0.0.1:43173"), LOCAL_DEV_ORIGIN)
  assert.equal(parseAppOrigin("http://127.0.0.1:43173/"), LOCAL_DEV_ORIGIN)
  assert.equal(parseAppOrigin("http://localhost:43173"), "http://localhost:43173")
  assert.equal(
    resolveAppOrigin("http://127.0.0.1:43173", "production"),
    LOCAL_DEV_ORIGIN
  )
  assert.equal(resolveAppOrigin("", "development"), LOCAL_DEV_ORIGIN)
  assert.equal(resolveAppOrigin("  ", "test"), LOCAL_DEV_ORIGIN)
})

test("origin: production does not silently default to localhost", () => {
  assert.throws(
    () => resolveAppOrigin("", "production"),
    /APP_ORIGIN is required in production/
  )
  assert.throws(() => resolveAppOrigin("   ", "production"), /APP_ORIGIN is required/)
})

test("origin: production rejects HTTP and malformed values", () => {
  const invalid = [
    "http://example.com",
    "http://focus-cell.vercel.app",
    "https://user:pass@example.com",
    "https://example.com/app",
    "https://example.com?next=/",
    "https://example.com#frag",
    "https://example.com/api/settings",
    "ftp://example.com",
    "javascript:alert(1)",
    "https://*.example.com",
    "//example.com",
    "example.com",
    "not a url",
  ]
  for (const value of invalid) {
    assert.throws(() => parseAppOrigin(value), Error, value)
    assert.throws(() => resolveAppOrigin(value, "production"), Error, value)
  }
})

test("origin: HTTPS origins without a path are accepted", () => {
  assert.equal(parseAppOrigin("https://example.com"), "https://example.com")
  assert.equal(parseAppOrigin("https://example.com:443"), "https://example.com")
  assert.equal(
    parseAppOrigin("https://sheets.example:8443"),
    "https://sheets.example:8443"
  )
})

test("origin: production hosts do not allow localhost Origin headers", () => {
  assert.deepEqual(allowedRequestOrigins("https://example.com"), [
    "https://example.com",
  ])
  assert.deepEqual(allowedRequestOrigins(LOCAL_DEV_ORIGIN).sort(), [
    "http://127.0.0.1:43173",
    "http://localhost:43173",
  ])
})

test("origin: userscript bake writes only the confirmed host", () => {
  const baked = bakeUserscriptSyncOrigin(userscript, "https://example.com")
  assert.match(baked, /@connect\s+example\.com/)
  assert.doesNotMatch(baked, /@connect\s+\*/)
  assert.match(baked, /var SYNC_ORIGIN = "https:\/\/example.com"/)
  assert.doesNotMatch(baked, /var SYNC_ORIGIN = "http:\/\/127\.0\.0\.1:43173"/)
  assert.equal(
    bakeUserscriptSyncOrigin(userscript, LOCAL_DEV_ORIGIN),
    userscript
  )
  assert.throws(() => bakeUserscriptSyncOrigin(userscript, "http://example.com"))
  assert.throws(() => bakeUserscriptSyncOrigin(userscript, "https://example.com/app"))
})
