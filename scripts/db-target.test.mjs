import assert from "node:assert/strict"
import test from "node:test"

import {
  describeDatabaseTarget,
  hostedMigrateRequested,
} from "./db-target.mjs"

test("db-target: redacts credentials and keeps the host", () => {
  const target = describeDatabaseTarget(
    "postgres://focus:super-secret@ep-example.aws.neon.tech:5432/neondb?sslmode=require"
  )
  assert.equal(
    target.label,
    "postgres://focus:***@ep-example.aws.neon.tech:5432/neondb"
  )
  assert.equal(target.hosted, true)
  assert.doesNotMatch(target.label, /super-secret/)
  assert.doesNotMatch(target.label, /sslmode/)
})

test("db-target: loopback URLs are not hosted", () => {
  assert.equal(
    describeDatabaseTarget("postgres://postgres@127.0.0.1:5432/focus").hosted,
    false
  )
  assert.equal(
    describeDatabaseTarget("postgresql://localhost/focus").hosted,
    false
  )
})

test("db-target: rejects empty or non-postgres URLs without echoing them", () => {
  assert.throws(() => describeDatabaseTarget(""), /empty/)
  assert.throws(() => describeDatabaseTarget("not a url"), /not a valid URL/)
  assert.throws(
    () => describeDatabaseTarget("https://example.com/db"),
    /must be a postgres URL/
  )
})

test("db-target: hosted mode is opt-in", () => {
  assert.equal(hostedMigrateRequested({}, ["node", "db-migrate.mjs"]), false)
  assert.equal(
    hostedMigrateRequested({ MIGRATE_HOSTED: "1" }, ["node", "db-migrate.mjs"]),
    true
  )
  assert.equal(
    hostedMigrateRequested({}, ["node", "db-migrate.mjs", "--hosted"]),
    true
  )
})
