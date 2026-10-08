import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import postgres from "postgres"

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

const schema = readFileSync(join(root, "docs", "schema.sql"), "utf8")
const sql = postgres(url, { max: 1, onnotice: () => {} })

try {
  await sql.unsafe(schema)
  console.log("Applied schema: users, highlight_settings, oauth_pending.")
} catch (error) {
  const message = error instanceof Error ? error.message : "migration failed"
  console.error(message.replace(url, "[DATABASE_URL]"))
  process.exit(1)
} finally {
  await sql.end({ timeout: 5 })
}
