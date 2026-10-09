import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  publicUserscriptForOrigin,
  resolveRuntimeAppOrigin,
} from "../src/lib/auth/origin.ts"

// Production deploys bake @connect / SYNC_ORIGIN into public/ from the
// resolved HTTPS origin. The userscript source stays localhost for local
// development and tests. Run npm run sync to restore the committed copy.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourcePath = path.join(root, "userscript", "sheets-focus-cell.user.js")
const publicPath = path.join(root, "public", "sheets-focus-cell.user.js")

const origin = resolveRuntimeAppOrigin(process.env)
const source = readFileSync(sourcePath, "utf8")
const output = publicUserscriptForOrigin(source, origin)
writeFileSync(publicPath, output)
console.log(`userscript ${origin} -> public/sheets-focus-cell.user.js`)
