import { copyFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Copies stay byte-identical to their sources. Production HTTPS @connect is
// baked into public/ at `npm run build` by scripts/bake-userscript-origin.mjs.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

export const copies = [
  ["apps-script/Code.gs", "public/sheets-tools.gs"],
  ["userscript/sheets-focus-cell.user.js", "public/sheets-focus-cell.user.js"],
  ["userscript/sheets-focus-cell.user.js", "extension/content.js"],
]

for (const [from, to] of copies) {
  const target = path.join(root, to)
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(path.join(root, from), target)
  console.log(`${from} -> ${to}`)
}
