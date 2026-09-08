import assert from "node:assert/strict"
import test from "node:test"
import vm from "node:vm"

import { createHarness, userscriptSource } from "./dom-harness.mjs"

test("the file parses as plain script, not a module", () => {
  assert.doesNotThrow(() => new vm.Script(userscriptSource))
  assert.doesNotMatch(userscriptSource, /^\s*(import|export)\s/m)
})

test("a single cell gets one row band and one column band", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  assert.deepEqual(h.rowBands(), [
    { left: "0px", top: "60px", width: "100%", height: "20px" },
  ])
  assert.deepEqual(h.columnBands(), [
    { left: "240px", top: "0px", width: "90px", height: "100%" },
  ])
})

test("moving the cell leaves no stale band behind", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  const borders = h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  borders[0].at(160, 320, 90, 2)
  borders[1].at(248, 320, 2, 20)
  borders[2].at(160, 338, 90, 2)
  borders[3].at(160, 320, 2, 20)
  h.dispatch("click")
  h.flush()

  assert.equal(h.visibleBands().length, 2)
  assert.deepEqual(h.rowBands(), [
    { left: "0px", top: "120px", width: "100%", height: "20px" },
  ])
  assert.deepEqual(h.columnBands(), [
    { left: "60px", top: "0px", width: "90px", height: "100%" },
  ])
})

test("a block selection covers every row and column in the block", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.selection(grid, 200, 240, 270, 80)
  h.dispatch("click")
  h.flush()

  assert.deepEqual(h.rowBands(), [
    { left: "0px", top: "40px", width: "100%", height: "80px" },
  ])
  assert.deepEqual(h.columnBands(), [
    { left: "100px", top: "0px", width: "270px", height: "100%" },
  ])
})

test("two separate picks stay two separate bands", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.selection(grid, 200, 240, 90, 20)
  h.selection(grid, 200, 340, 90, 20)
  h.dispatch("click")
  h.flush()

  // Regression: merge once compared an undefined property, so the second pick
  // was folded into the first and produced a single band spanning the gap.
  assert.deepEqual(h.rowBands(), [
    { left: "0px", top: "40px", width: "100%", height: "20px" },
    { left: "0px", top: "140px", width: "100%", height: "20px" },
  ])
})

test("adjacent picks collapse into one band so opacity stays even", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.selection(grid, 200, 240, 90, 20)
  h.selection(grid, 200, 258, 90, 20)
  h.dispatch("click")
  h.flush()

  assert.deepEqual(h.rowBands(), [
    { left: "0px", top: "40px", width: "100%", height: "38px" },
  ])
})

/**
 * Whole-row and whole-column picks deliberately add nothing. Sheets draws them
 * overflowing the grid and already tints them edge to edge, so a band on top
 * would only double-darken. These tests pin that down: the danger is not a
 * missing band, it is a band spanning the entire grid.
 */
test("a whole-row pick adds no band, because Sheets already tints the row", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.selection(grid, 100, 260, 1000, 20)
  h.selection(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  assert.deepEqual(h.visibleBands(), [])
})

test("a whole-column pick adds no band either", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.selection(grid, 340, 200, 90, 600)
  h.selection(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  assert.deepEqual(h.visibleBands(), [])
})

test("a whole-row pick plus a separate cell still highlights that cell", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.selection(grid, 100, 260, 1000, 20)
  h.selection(grid, 340, 340, 90, 20)
  h.dispatch("click")
  h.flush()

  assert.deepEqual(h.rowBands(), [
    { left: "0px", top: "140px", width: "100%", height: "20px" },
  ])
  assert.deepEqual(h.columnBands(), [
    { left: "240px", top: "0px", width: "90px", height: "100%" },
  ])
})

test("selecting the whole sheet highlights nothing rather than everything", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.selection(grid, 100, 200, 1000, 600)
  h.dispatch("click")
  h.flush()

  assert.deepEqual(h.visibleBands(), [])
})

test("a frozen pane duplicating the outline still highlights one row", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.activeCell(grid, 430, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  // Eight outline elements used to switch the highlight off entirely.
  assert.deepEqual(h.rowBands(), [
    { left: "0px", top: "60px", width: "100%", height: "20px" },
  ])
  assert.deepEqual(h.columnBands(), [
    { left: "240px", top: "0px", width: "180px", height: "100%" },
  ])
})

test("an outline element outside the grid is ignored", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)

  const stray = h.element()
  stray.className = "selection"
  stray.at(0, 0, 50, 50)
  h.body.appendChild(stray)

  h.dispatch("click")
  h.flush()

  assert.deepEqual(h.rowBands(), [
    { left: "0px", top: "60px", width: "100%", height: "20px" },
  ])
})

test("Ctrl+Shift+H hides the bands and restores them", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()
  assert.equal(h.visibleBands().length, 2)

  h.dispatch("keydown", { ctrlKey: true, shiftKey: true, code: "KeyH" })
  assert.deepEqual(h.visibleBands(), [])

  h.dispatch("keydown", { ctrlKey: true, shiftKey: true, code: "KeyH" })
  assert.equal(h.visibleBands().length, 2)
})

test("the toggle also works with event.key when event.code is missing", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  h.dispatch("keydown", { ctrlKey: true, shiftKey: true, key: "H" })
  assert.deepEqual(h.visibleBands(), [])
})

test("the toggle works with Cmd+Shift+H on a Mac", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  h.dispatch("keydown", { metaKey: true, shiftKey: true, code: "KeyH" })
  assert.deepEqual(h.visibleBands(), [])
})

test("Firefox can toggle with Ctrl+Shift+Period when History owns H", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  h.dispatch("keydown", { ctrlKey: true, shiftKey: true, code: "Period" })
  assert.deepEqual(h.visibleBands(), [])
})

test("paints on the next timeout when requestAnimationFrame is missing", () => {
  const h = createHarness({ noAnimationFrame: true })
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  assert.equal(h.pendingFrames(), 1)
  h.flush()
  assert.equal(h.visibleBands().length, 2)
})

test("typing does not toggle the highlight", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  h.dispatch("keydown", { code: "KeyH" })
  h.dispatch("keydown", { ctrlKey: true, code: "KeyH" })
  h.dispatch("keydown", { shiftKey: true, code: "KeyH" })
  h.flush()

  assert.equal(h.visibleBands().length, 2)
})

test("no grid and a zero-size grid both stay quiet", () => {
  const missing = createHarness()
  assert.doesNotThrow(() => {
    missing.dispatch("click")
    missing.flush()
  })
  assert.deepEqual(missing.visibleBands(), [])

  const empty = createHarness()
  const grid = empty.grid(0, 0, 0, 0)
  empty.activeCell(grid, 0, 0, 0, 0)
  assert.doesNotThrow(() => {
    empty.dispatch("click")
    empty.flush()
  })
  assert.deepEqual(empty.visibleBands(), [])
})

test("a cell with no outline elements draws nothing", () => {
  const h = createHarness()
  h.grid(100, 200, 800, 400)
  h.dispatch("click")
  h.flush()
  assert.deepEqual(h.visibleBands(), [])
})

test("bursts of events collapse into a single frame", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.flush()

  for (let i = 0; i < 20; i++) {
    h.dispatch("scroll")
    h.dispatch("keyup")
  }
  assert.equal(h.pendingFrames(), 1)
  assert.equal(h.flush(), 1)
})

test("scrolling keeps the band on the cell, not on the screen", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  const borders = h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  const scrolled = 260 - 60
  borders[0].at(340, scrolled, 90, 2)
  borders[1].at(428, scrolled, 2, 20)
  borders[2].at(340, scrolled + 18, 90, 2)
  borders[3].at(340, scrolled, 2, 20)
  h.dispatch("scroll")
  h.flush()

  assert.deepEqual(h.rowBands(), [
    { left: "0px", top: "0px", width: "100%", height: "20px" },
  ])
})

test("the overlay never intercepts clicks", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  assert.equal(h.overlay().style.pointerEvents, "none")
  for (const band of h.overlay().childNodes) {
    assert.equal(band.style.pointerEvents, "none")
  }
})

test("the overlay is re-attached if Sheets replaces the body content", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  const overlay = h.overlay()
  h.body.childNodes = h.body.childNodes.filter((node) => node !== overlay)
  overlay.parentNode = null

  h.dispatch("click")
  h.flush()
  assert.equal(h.overlay(), overlay)
  assert.equal(h.visibleBands().length, 2)
})

test("switching tabs re-attaches the observer to the new grid", () => {
  const h = createHarness()
  const first = h.grid(100, 200, 800, 400)
  h.activeCell(first, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()
  assert.equal(h.observers.length, 1)
  assert.equal(h.observers[0].target, first)

  h.body.childNodes = h.body.childNodes.filter((node) => node !== first)
  const second = h.grid(100, 200, 800, 400)
  h.activeCell(second, 200, 240, 90, 20)
  h.dispatch("click")
  h.flush()

  assert.equal(h.observers.length, 2)
  assert.equal(h.observers[0].disconnected, true)
  assert.equal(h.observers[1].target, second)
  assert.equal(h.visibleBands().length, 2)
})

test("an unchanged selection does not rewrite the bands", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  const before = h.overlay().childNodes.map((band) => band.style)
  h.dispatch("click")
  h.flush()
  const after = h.overlay().childNodes.map((band) => band.style)

  for (let i = 0; i < before.length; i++) {
    assert.equal(before[i], after[i], "style object was replaced")
  }
})

test("a saved colour is used without editing the script", () => {
  const h = createHarness({
    storage: {
      "sheets-focus-cell": JSON.stringify({
        color: "#217346",
        opacity: "0.2",
      }),
    },
  })
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  const band = h.overlay().childNodes.find((node) => node.style.display === "block")
  assert.equal(band.style.backgroundColor, "#217346")
  assert.equal(band.style.opacity, "0.2")
})

test("changing the colour updates the bands immediately and is remembered", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  h.dispatch("sheets-focus-cell:set", { detail: { color: "#d93025" } })

  const band = h.overlay().childNodes.find((node) => node.style.display === "block")
  assert.equal(band.style.backgroundColor, "#d93025")
  assert.match(h.storage["sheets-focus-cell"], /#d93025/)
})

test("an invalid colour is ignored so a bad picker value cannot blank the highlight", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  h.dispatch("sheets-focus-cell:set", { detail: { color: "not-a-colour" } })
  const band = h.overlay().childNodes.find((node) => node.style.display === "block")
  assert.equal(band.style.backgroundColor, "#1a73e8")
})

test("the colour chip sits outside the overlay so it can still receive clicks", () => {
  const h = createHarness()
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()

  assert.ok(h.panel())
  assert.notEqual(h.panel().parentNode, h.overlay())
  assert.equal(h.panel().style.pointerEvents, "auto")
  assert.equal(h.overlay().style.pointerEvents, "none")
})
