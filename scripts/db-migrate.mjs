import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import postgres from "postgres"

import { describeDatabaseTarget, hostedMigrateRequested } from "./db-target.mjs"
import { loadLocalEnv } from "./load-local-env.mjs"

loadLocalEnv()

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const url = process.env.DATABASE_URL ? process.env.DATABASE_URL.trim() : ""

if (!url) {
  console.error(
    "DATABASE_URL is required. Copy .env.example to .env.local and set a Postgres URL."
  )
  process.exit(1)
}

let target
try {
  target = describeDatabaseTarget(url)
} catch (error) {
  console.error(error instanceof Error ? error.message : "DATABASE_URL is invalid")
  process.exit(1)
}

if (hostedMigrateRequested() && !target.hosted) {
  console.error(
    "Refusing to migrate a loopback database while MIGRATE_HOSTED=1 or --hosted is set. Pass the hosted DATABASE_URL in the environment so .env.local cannot be used by accident."
  )
  process.exit(2)
}

console.log(`Migrating ${target.label}`)

const schema = readFileSync(join(root, "docs", "schema.sql"), "utf8")
const sql = postgres(url, { max: 1, onnotice: () => {} })

try {
  await sql.unsafe(schema)
  console.log(
    "Applied schema: users, highlight_settings, oauth_pending, sync_requests, sync_tokens."
  )
} catch (error) {
  const message = error instanceof Error ? error.message : "migration failed"
  console.error(message.replace(url, "[DATABASE_URL]"))
  process.exit(1)
} finally {
  await sql.end({ timeout: 5 })
}
