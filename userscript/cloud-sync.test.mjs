import assert from "node:assert/strict"
import test from "node:test"

import { createHarness } from "./dom-harness.mjs"

function paint(h) {
  const grid = h.grid(100, 200, 800, 400)
  h.activeCell(grid, 340, 260, 90, 20)
  h.dispatch("click")
  h.flush()
  return h.overlay().childNodes.find((node) => node.style.display === "block")
}

function jsonResponse(status, body) {
  return {
    status,
    responseText: JSON.stringify(body),
    responseHeaders: "content-type: application/json",
  }
}

function respond(details, status, body) {
  details.onload(jsonResponse(status, body))
}

test("sync: local-first paint with sync disabled by default", () => {
  const h = createHarness({
    gm: {
      "sheets-focus-cell": JSON.stringify({
        color: "#217346",
        opacity: "0.2",
        seenTip: true,
      }),
    },
  })
  const band = paint(h)
  assert.equal(band.style.backgroundColor, "#217346")
  assert.equal(band.style.opacity, "0.2")
  assert.equal(h.findByAria("Cloud sync state").textContent, "Cloud sync: off")
  assert.equal(h.xhrCalls.length, 0)
})

test("sync: colour still changes when signed out and sync is off", () => {
  const h = createHarness()
  const band = paint(h)
  h.dispatch("sheets-focus-cell:set", { detail: { color: "#d93025" } })
  assert.equal(band.style.backgroundColor, "#d93025")
  assert.equal(h.xhrCalls.length, 0)
  const saved = JSON.parse(h.gm["sheets-focus-cell"])
  assert.equal(saved.color, "#d93025")
  assert.equal("token" in saved, false)
})

test("sync: seenTip stays in local storage and is not uploaded", () => {
  const h = createHarness({
    gmXhr(details) {
      if (String(details.url).includes("/api/settings") && details.method === "PUT") {
        const body = JSON.parse(details.data)
        assert.equal("seenTip" in body, false)
        respond(details, 200, {
          color: body.color,
          opacity: body.opacity,
          updatedAt: "2026-10-09T00:00:00.000Z",
        })
        return
      }
      details.onerror({ error: "unexpected" })
    },
  })
  paint(h)
  h.findByAria("Highlight colour").click()
  const saved = JSON.parse(h.gm["sheets-focus-cell"])
  assert.equal(saved.seenTip, true)
  assert.equal(h.gm["sheets-focus-cell-sync"], undefined)
})

test("sync: accepted GET settings are validated, stored, and painted", () => {
  const h = createHarness({
    gm: {
      "sheets-focus-cell": JSON.stringify({
        color: "#1a73e8",
        opacity: "0.1",
        seenTip: true,
      }),
      "sheets-focus-cell-sync": JSON.stringify({
        enabled: true,
        token: "fcs_test",
        email: "user@example.com",
        cloudUpdatedAt: "",
      }),
    },
    gmXhr(details) {
      assert.equal(details.anonymous, true)
      assert.match(details.headers.authorization, /^Bearer fcs_test$/)
      assert.equal(details.url, "http://127.0.0.1:43173/api/settings")
      respond(details, 200, {
        color: "#ffffff",
        opacity: "0.3",
        updatedAt: "2026-10-09T12:00:00.000Z",
      })
    },
  })
  const band = paint(h)
  assert.equal(band.style.backgroundColor, "#ffffff")
  assert.equal(band.style.opacity, "0.3")
  const local = JSON.parse(h.gm["sheets-focus-cell"])
  assert.equal(local.color, "#ffffff")
  assert.equal(local.opacity, "0.3")
  assert.equal(local.seenTip, true)
  const sync = JSON.parse(h.gm["sheets-focus-cell-sync"])
  assert.equal(sync.cloudUpdatedAt, "2026-10-09T12:00:00.000Z")
  assert.match(h.findByAria("Cloud sync state").textContent, /on/)
})

test("sync: invalid server colour is ignored so local paint survives", () => {
  const h = createHarness({
    gm: {
      "sheets-focus-cell": JSON.stringify({ color: "#217346", opacity: "0.2" }),
      "sheets-focus-cell-sync": JSON.stringify({
        enabled: true,
        token: "fcs_test",
      }),
    },
    gmXhr(details) {
      respond(details, 200, {
        color: "javascript:alert(1)",
        opacity: "0.3",
        updatedAt: "2026-10-09T12:00:00.000Z",
      })
    },
  })
  const band = paint(h)
  assert.equal(band.style.backgroundColor, "#217346")
  assert.equal(JSON.parse(h.gm["sheets-focus-cell"]).color, "#217346")
})

test("sync: network failure keeps using local settings", () => {
  const h = createHarness({
    gm: {
      "sheets-focus-cell": JSON.stringify({ color: "#e8710a", opacity: "0.33" }),
      "sheets-focus-cell-sync": JSON.stringify({
        enabled: true,
        token: "fcs_test",
      }),
    },
    gmXhr(details) {
      details.onerror({ error: "offline" })
    },
  })
  const band = paint(h)
  assert.equal(band.style.backgroundColor, "#e8710a")
  h.dispatch("sheets-focus-cell:set", { detail: { color: "#a142f4" } })
  assert.equal(band.style.backgroundColor, "#a142f4")
})

test("sync: local colour change uploads with baseUpdatedAt and without seenTip", () => {
  const puts = []
  const h = createHarness({
    gm: {
      "sheets-focus-cell": JSON.stringify({
        color: "#1a73e8",
        opacity: "0.1",
        seenTip: true,
      }),
      "sheets-focus-cell-sync": JSON.stringify({
        enabled: true,
        token: "fcs_test",
        cloudUpdatedAt: "2026-10-09T11:00:00.000Z",
      }),
    },
    gmXhr(details) {
      if (details.method === "GET") {
        respond(details, 200, {
          color: "#1a73e8",
          opacity: "0.1",
          updatedAt: "2026-10-09T11:00:00.000Z",
        })
        return
      }
      puts.push(JSON.parse(details.data))
      respond(details, 200, {
        color: "#ffffff",
        opacity: "0.3",
        updatedAt: "2026-10-09T12:00:00.000Z",
      })
    },
  })
  paint(h)
  h.dispatch("sheets-focus-cell:set", {
    detail: { color: "#ffffff", opacity: "0.3" },
  })
  h.flush()
  assert.equal(puts.length, 1)
  assert.equal(puts[0].color, "#ffffff")
  assert.equal(puts[0].opacity, "0.3")
  assert.equal(puts[0].baseUpdatedAt, "2026-10-09T11:00:00.000Z")
  assert.equal("seenTip" in puts[0], false)
})

test("sync: stale baseUpdatedAt applies the server row instead of looping", () => {
  let puts = 0
  let gets = 0
  const h = createHarness({
    gm: {
      "sheets-focus-cell-sync": JSON.stringify({
        enabled: true,
        token: "fcs_test",
        cloudUpdatedAt: "2026-10-09T10:00:00.000Z",
      }),
    },
    gmXhr(details) {
      if (details.method === "GET") {
        gets += 1
        respond(details, 200, {
          color: "#1a73e8",
          opacity: "0.1",
          updatedAt: "2026-10-09T10:00:00.000Z",
        })
        return
      }
      puts += 1
      respond(details, 409, {
        error: "conflict",
        settings: {
          color: "#f9ab00",
          opacity: "0.2",
          updatedAt: "2026-10-09T12:30:00.000Z",
        },
      })
    },
  })
  const band = paint(h)
  h.dispatch("sheets-focus-cell:set", { detail: { color: "#d93025" } })
  h.flush()
  assert.equal(puts, 1)
  assert.equal(band.style.backgroundColor, "#f9ab00")
  assert.equal(JSON.parse(h.gm["sheets-focus-cell-sync"]).cloudUpdatedAt, "2026-10-09T12:30:00.000Z")
  const extraPuts = puts
  h.flush()
  h.flush()
  assert.equal(puts, extraPuts)
  assert.ok(gets >= 1)
})

test("sync: 401 disables cloud and keeps the local colour", () => {
  const h = createHarness({
    gm: {
      "sheets-focus-cell": JSON.stringify({ color: "#217346", opacity: "0.2" }),
      "sheets-focus-cell-sync": JSON.stringify({
        enabled: true,
        token: "fcs_old",
        email: "user@example.com",
      }),
    },
    gmXhr(details) {
      respond(details, 401, { error: "unauthenticated" })
    },
  })
  const band = paint(h)
  assert.equal(band.style.backgroundColor, "#217346")
  assert.equal(h.findByAria("Cloud sync state").textContent, "Cloud sync: off")
  assert.equal(JSON.parse(h.gm["sheets-focus-cell-sync"]).token, "")
  assert.equal(JSON.parse(h.gm["sheets-focus-cell-sync"]).enabled, false)
})

test("sync: enable opens a Focus Cell URL and does not call fetch", () => {
  const h = createHarness({
    gmXhr(details) {
      if (String(details.url).includes("/api/sync/prepare")) {
        respond(details, 200, {
          requestId: "req-1",
          pollSecret: "secret-1",
          authorizePath: "/sync?request=req-1",
        })
        return
      }
      if (String(details.url).includes("/api/sync/poll")) {
        respond(details, 200, { status: "pending" })
        return
      }
      details.onerror({ error: "unexpected" })
    },
  })
  paint(h)
  h.findByAria("Enable cloud sync").click()
  const prepare = h.xhrCalls.find((call) => String(call.url).includes("/api/sync/prepare"))
  assert.ok(prepare)
  assert.equal(prepare.anonymous, true)
  assert.equal(h.findByAria("Open Focus Cell sign-in").href, "http://127.0.0.1:43173/sync?request=req-1")
  assert.doesNotMatch(
    String(h.findByAria("Open Focus Cell sign-in").href),
    /evil|javascript:/
  )
})

test("sync: unpacked extension without GM_xmlhttpRequest still highlights", () => {
  const h = createHarness({ noGm: true })
  const band = paint(h)
  assert.equal(band.style.backgroundColor, "#1a73e8")
  h.findByAria("Enable cloud sync").click()
  assert.equal(band.style.backgroundColor, "#1a73e8")
  assert.match(
    h.findByAria("Cloud sync status").textContent,
    /Tampermonkey|Local colour/
  )
})
