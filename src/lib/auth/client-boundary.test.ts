import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, files)
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.includes(".test.")) {
      files.push(full)
    }
  }
  return files
}

const serverOnly = [
  "@/lib/auth/config",
  "@/lib/auth/session",
  "@/lib/auth/google",
  "@/lib/auth/handlers",
  "@/lib/settings/postgres-store",
  "@/lib/settings/get-store",
  "googleClientSecret",
  "SESSION_SECRET",
  "DATABASE_URL",
]

test("client boundary: client components do not import server secrets", () => {
  const files = walk(path.join(root, "src", "components"))
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8")
    if (!source.includes('"use client"') && !source.includes("'use client'")) {
      continue
    }
    for (const needle of serverOnly) {
      assert.doesNotMatch(
        source,
        new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `${path.relative(root, file)} must not reference ${needle}`
      )
    }
  }
})

test("client boundary: no NEXT_PUBLIC_ OAuth or database variables", () => {
  const files = walk(path.join(root, "src"))
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8")
    assert.doesNotMatch(source, /NEXT_PUBLIC_GOOGLE_CLIENT/)
    assert.doesNotMatch(source, /NEXT_PUBLIC_SESSION/)
    assert.doesNotMatch(source, /NEXT_PUBLIC_DATABASE/)
  }
})

test("env example is placeholders only and gitignore allows it", () => {
  const example = fs.readFileSync(path.join(root, ".env.example"), "utf8")
  const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8")
  assert.match(gitignore, /\.env\*/)
  assert.match(gitignore, /!\.env\.example/)
  assert.match(example, /GOOGLE_CLIENT_ID=/)
  assert.match(example, /GOOGLE_CLIENT_SECRET=/)
  assert.match(example, /DATABASE_URL=/)
  assert.match(example, /SESSION_SECRET=/)
  assert.doesNotMatch(example, /^NEXT_PUBLIC_/m)
  assert.doesNotMatch(example, /sk_live|ya29\.|AIza[0-9A-Za-z_-]{20,}/)
  for (const line of example.split("\n")) {
    if (!line.includes("=") || line.trim().startsWith("#")) {
      continue
    }
    const [, value] = line.split("=", 2)
    if (line.startsWith("GOOGLE_REDIRECT_URI=") || line.startsWith("APP_ORIGIN=")) {
      assert.match(value, /^https?:\/\/127\.0\.0\.1:43173/)
      continue
    }
    assert.equal(value, "", `unexpected value on ${line}`)
  }
})
