import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

export const userscriptPath = path.join(
  root,
  "userscript",
  "sheets-focus-cell.user.js"
)
export const userscriptSource = fs.readFileSync(userscriptPath, "utf8")

/**
 * Enough of a DOM to run the real userscript file in Node. jsdom reports every
 * rectangle as zero, which is exactly the input this code cares about, so the
 * boxes are set explicitly per element instead.
 */
class FakeElement {
  constructor(tag) {
    this.tagName = tag
    this.style = {}
    this.childNodes = []
    this.parentNode = null
    this.className = ""
    this.id = ""
    this.box = { left: 0, top: 0, width: 0, height: 0 }
  }

  appendChild(child) {
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  at(left, top, width, height) {
    this.box = { left, top, width, height }
    return this
  }

  getBoundingClientRect() {
    const { left, top, width, height } = this.box
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    }
  }

  descendants() {
    return this.childNodes.flatMap((child) => [child, ...child.descendants()])
  }

  getElementsByClassName(name) {
    return this.descendants().filter((node) =>
      String(node.className).split(/\s+/).includes(name)
    )
  }
}

export function createHarness(options = {}) {
  const body = new FakeElement("body")
  const frames = []
  const listeners = new Map()
  const observers = []

  const document = {
    body,
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) =>
      body.descendants().find((node) => node.id === id) ?? null,
  }

  const queueFrame = (callback) => frames.push(callback)

  const window = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(handler)
    },
    requestAnimationFrame: queueFrame,
    webkitRequestAnimationFrame: queueFrame,
    mozRequestAnimationFrame: queueFrame,
    setTimeout: (callback) => {
      frames.push(callback)
      return 0
    },
  }

  if (options.noAnimationFrame) {
    delete window.requestAnimationFrame
    delete window.webkitRequestAnimationFrame
    delete window.mozRequestAnimationFrame
  }

  class MutationObserver {
    constructor(callback) {
      this.callback = callback
      this.target = null
      this.disconnected = false
      observers.push(this)
    }
    observe(target) {
      this.target = target
    }
    disconnect() {
      this.disconnected = true
    }
  }

  const sandbox = {
    document,
    window,
    MutationObserver,
    requestAnimationFrame: window.requestAnimationFrame,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Infinity,
    console,
  }

  vm.runInNewContext(userscriptSource, sandbox, { filename: userscriptPath })

  const harness = {
    document,
    body,
    element: (tag = "div") => new FakeElement(tag),

    /** Build a grid container with the ids and classes Sheets exposes. */
    grid(left = 100, top = 200, width = 800, height = 400) {
      const node = new FakeElement("div")
      node.id = "waffle-grid-container"
      node.at(left, top, width, height)
      body.appendChild(node)
      return node
    },

    /** The four outline elements Sheets draws around one cell. */
    activeCell(grid, left, top, width, height) {
      const sides = [
        [left, top, width, 2],
        [left + width - 2, top, 2, height],
        [left, top + height - 2, width, 2],
        [left, top, 2, height],
      ]
      return sides.map(([x, y, w, h]) => {
        const node = new FakeElement("div")
        node.className = "active-cell-border"
        node.at(x, y, w, h)
        return grid.appendChild(node)
      })
    },

    selection(grid, left, top, width, height) {
      const node = new FakeElement("div")
      node.className = "selection"
      node.at(left, top, width, height)
      return grid.appendChild(node)
    },

    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) ?? []) {
        handler({ preventDefault() {}, stopPropagation() {}, ...event })
      }
    },

    /** Run whatever the script queued for the next frame. */
    flush() {
      const queued = frames.splice(0, frames.length)
      for (const callback of queued) callback()
      return queued.length
    },

    pendingFrames: () => frames.length,
    observers,

    overlay: () =>
      body.childNodes.find((node) => node.id === "sheets-focus-cell-overlay"),

    /** Only the bands currently drawn, as plain numbers. */
    visibleBands() {
      const overlay = harness.overlay()
      if (!overlay || overlay.style.display === "none") return []
      return overlay.childNodes
        .filter((node) => node.style.display === "block")
        .map((node) => ({
          left: node.style.left,
          top: node.style.top,
          width: node.style.width,
          height: node.style.height,
        }))
    },

    rowBands() {
      return harness.visibleBands().filter((band) => band.width === "100%")
    },

    columnBands() {
      return harness.visibleBands().filter((band) => band.height === "100%")
    },
  }

  return harness
}
