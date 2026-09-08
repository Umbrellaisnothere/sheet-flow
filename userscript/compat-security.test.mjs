import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { createHarness, userscriptSource } from "./dom-harness.mjs"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const readme = fs.readFileSync(path.join(root, "userscript", "README.md"), "utf8")
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "extension", "manifest.json"), "utf8")
)
const header = userscriptSource.slice(
  0,
  userscriptSource.indexOf("==/UserScript==") + "==/UserScript==".length
)

function paint(h) {
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()
  return h
    .overlay()
    .childNodes.find((node) => node.style.display === "block")
}

function overlayCount(h) {
  return h.descendants().filter((node) => node.id === "sheets-focus-cell-overlay")
    .length
}

async function drain() {
  await Promise.resolve()
  await Promise.resolve()
}

// --- Compatibility ----------------------------------------------------------

test("compat: Tampermonkey metadata only targets HTTPS Sheets URLs", () => {
  assert.match(header, /@match\s+https:\/\/docs\.google\.com\/spreadsheets\/\*/)
  assert.match(header, /@include\s+https:\/\/docs\.google\.com\/spreadsheets\/\*/)
  assert.doesNotMatch(header, /@match\s+http:/)
  assert.doesNotMatch(header, /@include\s+http:/)
  assert.doesNotMatch(header, /@match\s+\*/)
  assert.doesNotMatch(header, /@include\s+\*/)
})

test("compat: grants are storage-only, not network or cookies", () => {
  const grants = [...header.matchAll(/@grant\s+(\S+)/g)].map((match) => match[1])
  for (const grant of grants) {
    assert.match(
      grant,
      /^(GM_getValue|GM_setValue|GM\.getValue|GM\.setValue)$/,
      "unexpected grant " + grant
    )
  }
  assert.doesNotMatch(header, /GM_xmlhttpRequest|GM_cookie|unsafeWindow|window.close/)
  assert.doesNotMatch(header, /@connect|@require|@resource/)
})

test("compat: the file stays Tampermonkey-parseable ES5-style script", () => {
  assert.match(userscriptSource, /^\(function \(\) \{/m)
  assert.doesNotMatch(userscriptSource, /^\s*(import|export)\s/m)
  assert.doesNotMatch(userscriptSource, /\basync\s+function\b/)
  assert.doesNotMatch(userscriptSource, /\bawait\s/)
  assert.doesNotMatch(userscriptSource, /\?\./)
  assert.match(header, /@run-at\s+document-idle/)
  assert.match(header, /@inject-into\s+auto/)
})

test("compat: userscript and unpacked extension versions stay aligned", () => {
  const version = header.match(/@version\s+(\S+)/)[1]
  assert.equal(manifest.version, version)
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://docs.google.com/spreadsheets/*",
  ])
  assert.equal(manifest.content_scripts[0].all_frames, true)
})

test("compat: unpacked extension (no GM API) still highlights and saves locally", () => {
  const h = createHarness({ noGm: true })
  const band = paint(h)
  assert.equal(band.style.backgroundColor, "#1a73e8")
  h.dispatch("sheets-focus-cell:set", { detail: { color: "#217346" } })
  assert.equal(band.style.backgroundColor, "#217346")
  assert.match(h.storage["sheets-focus-cell"], /#217346/)
  assert.equal(h.gm["sheets-focus-cell"], undefined)
})

test("compat: Violentmonkey async GM.getValue is applied before use", async () => {
  const h = createHarness({
    gmAsync: true,
    gm: {
      "sheets-focus-cell": JSON.stringify({
        color: "#a142f4",
        opacity: "0.2",
      }),
    },
  })
  await drain()
  const band = paint(h)
  assert.equal(band.style.backgroundColor, "#a142f4")
  assert.equal(band.style.opacity, "0.2")
})

test("compat: no MutationObserver still paints on click", () => {
  const h = createHarness({ noMutationObserver: true })
  const band = paint(h)
  assert.equal(h.visibleBands().length, 2)
  assert.equal(band.style.backgroundColor, "#1a73e8")
})

test("compat: private mode (storage throws) still highlights", () => {
  const h = createHarness({
    noGm: true,
    localStorageThrows: true,
  })
  assert.doesNotThrow(() => paint(h))
  const band = h
    .overlay()
    .childNodes.find((node) => node.style.display === "block")
  assert.equal(band.style.backgroundColor, "#1a73e8")
  assert.doesNotThrow(() =>
    h.dispatch("sheets-focus-cell:set", { detail: { color: "#d93025" } })
  )
  assert.equal(band.style.backgroundColor, "#d93025")
})

test("compat: a second Tampermonkey copy does not stack overlays", () => {
  const h = createHarness()
  paint(h)
  assert.equal(overlayCount(h), 1)
  assert.doesNotThrow(() => h.injectAgain())
  assert.equal(overlayCount(h), 1)
})

test("compat: missing Promise falls back to localStorage", () => {
  const h = createHarness({
    noPromise: true,
    storage: {
      "sheets-focus-cell": JSON.stringify({ color: "#f9ab00", opacity: "0.2" }),
    },
  })
  const band = paint(h)
  assert.equal(band.style.backgroundColor, "#f9ab00")
})

// --- Security ---------------------------------------------------------------

test("security: the script never talks to the network or evals strings", () => {
  assert.doesNotMatch(
    userscriptSource,
    /fetch\s*\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/
  )
  assert.doesNotMatch(userscriptSource, /\beval\s*\(|new Function\s*\(/)
  assert.doesNotMatch(userscriptSource, /document\.write|innerHTML|outerHTML|insertAdjacentHTML/)
  assert.doesNotMatch(userscriptSource, /javascript:/)
})

test("security: stored XSS payloads cannot become a highlight colour", () => {
  const attacks = [
    "javascript:alert(1)",
    "url(https://evil.example/x)",
    "<img src=x onerror=alert(1)>",
    "#1a73e8;background:url(https://evil.example)",
    "expression(alert(1))",
  ]
  for (const attack of attacks) {
    const h = createHarness()
    const band = paint(h)
    const detail = { color: attack }
    h.dispatch("sheets-focus-cell:set", { detail })
    assert.equal(
      band.style.backgroundColor,
      "#1a73e8",
      "accepted " + JSON.stringify(attack)
    )
  }
})

test("security: corrupt Tampermonkey storage is ignored instead of crashing", () => {
  const h = createHarness({
    gm: { "sheets-focus-cell": "{not-json" },
    storage: { "sheets-focus-cell": "<script>alert(1)</script>" },
  })
  assert.doesNotThrow(() => paint(h))
  const band = h
    .overlay()
    .childNodes.find((node) => node.style.display === "block")
  assert.equal(band.style.backgroundColor, "#1a73e8")
})

test("security: a throwing GM_getValue falls back instead of taking the page down", () => {
  const h = createHarness({
    gmGetThrows: true,
    storage: {
      "sheets-focus-cell": JSON.stringify({ color: "#217346", opacity: "0.2" }),
    },
  })
  const band = paint(h)
  assert.equal(band.style.backgroundColor, "#217346")
})

test("security: the overlay cannot steal clicks from the grid", () => {
  const h = createHarness()
  paint(h)
  assert.equal(h.overlay().style.pointerEvents, "none")
  assert.equal(h.panel().style.pointerEvents, "auto")
})

// --- Functionality ----------------------------------------------------------

test("function: 3-digit hex expands and a typed value without # is saved", () => {
  const h = createHarness()
  const band = paint(h)
  h.dispatch("sheets-focus-cell:set", { detail: { color: "#0f0" } })
  assert.equal(band.style.backgroundColor, "#00ff00")
  h.dispatch("sheets-focus-cell:set", { detail: { color: "d93025" } })
  assert.equal(band.style.backgroundColor, "#d93025")
  const saved = JSON.parse(h.gm["sheets-focus-cell"])
  assert.equal(saved.color, "#d93025")
})

test("function: opacity is clamped so a wild value cannot hide the grid", () => {
  const h = createHarness()
  const band = paint(h)
  h.dispatch("sheets-focus-cell:set", { detail: { opacity: "9" } })
  assert.equal(band.style.opacity, "0.5")
  h.dispatch("sheets-focus-cell:set", { detail: { opacity: "-4" } })
  assert.equal(band.style.opacity, "0.05")
})

test("function: saved colour and opacity both come back after a reload", () => {
  const first = createHarness()
  paint(first)
  first.dispatch("sheets-focus-cell:set", {
    detail: { color: "#e8710a", opacity: "0.33" },
  })
  const payload = first.gm["sheets-focus-cell"]
  const second = createHarness({ gm: { "sheets-focus-cell": payload } })
  const band = paint(second)
  assert.equal(band.style.backgroundColor, "#e8710a")
  assert.equal(band.style.opacity, "0.33")
})

test("function: AltGr-style Ctrl+Alt+Shift+H does not toggle the highlight", () => {
  const h = createHarness()
  paint(h)
  h.dispatch("keydown", {
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
    code: "KeyH",
  })
  h.flush()
  assert.equal(h.visibleBands().length, 2)
})

// --- User-friendliness ------------------------------------------------------

test("ux: the colour chip and hex field are labelled for assistive tech", () => {
  const h = createHarness()
  paint(h)
  assert.equal(h.findByAria("Highlight colour").type, "button")
  assert.equal(h.findByAria("Hex colour").placeholder, "#1a73e8")
  assert.equal(h.findByAria("Highlight opacity").attrs.role, "slider")
  assert.match(h.findByAria("Highlight colour").title, /colour/i)
})

test("ux: the panel sits above the overlay so the chip stays clickable", () => {
  const h = createHarness()
  paint(h)
  assert.equal(Number(h.overlay().style.zIndex) < Number(h.panel().style.zIndex), true)
})

test("ux: Tampermonkey README covers Allow User Scripts, hex, and refresh", () => {
  assert.match(readme, /Allow User Scripts/)
  assert.match(readme, /#217346|hex/i)
  assert.match(readme, /Opacity/)
  assert.match(readme, /GM_setValue/)
  assert.match(readme, /Ctrl\+Shift\+H/)
  assert.match(readme, /edge:\/\/extensions|Tampermonkey for Edge/)
})
