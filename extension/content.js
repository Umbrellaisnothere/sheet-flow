// ==UserScript==
// @name         Focus Cell for Google Sheets
// @namespace    https://github.com/sheets-focus-cell
// @version      1.6.0
// @description  Excel-style active row and column highlight in Google Sheets, drawn in the browser so there is no Apps Script delay.
// @author       sheets-focus-cell
// @match        https://docs.google.com/spreadsheets/*
// @include      https://docs.google.com/spreadsheets/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @inject-into  auto
// ==/UserScript==

/**
 * Why this is not an Apps Script.
 *
 * onSelectionChange is a server-side simple trigger. Every click has to reach
 * Google, start a script container, mutate the document, and come back. That
 * round trip is seconds, and Google also drops selection events that happen
 * within two seconds of each other. No amount of tuning inside the trigger
 * gets under that floor.
 *
 * This draws the crosshair in the page instead, on the same frame as the
 * click. It reads where Sheets has already put the selection outline and lays
 * two translucent bands over the grid. It never touches the document, so it
 * cannot overwrite a fill, cannot trigger a recalculation, and costs no quota.
 *
 * The idea of reading the selection outline out of the DOM comes from
 * matsu7089's Sheets Row Highlighter (MIT).
 */

(function () {
  "use strict";

  // A second copy of the script (two Tampermonkey entries, or the
  // unpacked extension plus the userscript) must not stack overlays.
  if (
    typeof document !== "undefined" &&
    document.getElementById &&
    document.getElementById("sheets-focus-cell-overlay")
  ) {
    return;
  }

  var STORAGE_KEY = "sheets-focus-cell";
  var SYNC_KEY = "sheets-focus-cell-sync";
  var SYNC_ORIGIN = "http://127.0.0.1:43173";
  var SYNC_TIMEOUT_MS = 8000;
  var OPACITY_MIN = 0.05;
  var OPACITY_MAX = 0.5;
  var PRESETS = [
    "#1a73e8",
    "#217346",
    "#f9ab00",
    "#e8710a",
    "#a142f4",
    "#d93025",
  ];
  var CONFIG = {
    color: "#1a73e8",
    opacity: "0.1",
    row: true,
    column: true,
    seenTip: false,
  };

  // Sheets renders the grid to canvas, but keeps the selection outline as real
  // positioned elements. These are the hooks we read.
  var GRID_ID = "waffle-grid-container";
  var ACTIVE_BORDER_CLASS = "active-cell-border";
  var SELECTION_CLASS = "selection";

  var overlay = document.createElement("div");
  overlay.id = "sheets-focus-cell-overlay";
  var panel = document.createElement("div");
  panel.id = "sheets-focus-cell-panel";
  var swatch = document.createElement("button");
  var picker = document.createElement("input");
  var hexInput = document.createElement("input");
  var opacityTrack = document.createElement("div");
  var opacityThumb = document.createElement("div");
  var opacityValue = document.createElement("span");
  var tray = document.createElement("div");
  var toggleBtn = document.createElement("button");
  var shortcutLine = document.createElement("div");
  var tip = document.createElement("div");
  var presetButtons = [];
  var bands = [];
  var enabled = true;
  var queued = false;
  var signature = "";
  var observer = null;
  var observed = null;
  var panelOpen = false;
  var opacityDragging = false;
  var syncEnabled = false;
  var syncToken = "";
  var syncEmail = "";
  var cloudUpdatedAt = "";
  var syncStatus = "";
  var syncBusy = false;
  var applyingCloud = false;
  var cloudPushTimer = 0;
  var pollTimer = 0;
  var syncLine = null;
  var syncToggle = null;
  var syncOpen = null;
  var syncNote = null;

  function normalizeColor(value) {
    var text = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s/g, "");
    if (text.charAt(0) !== "#") {
      text = "#" + text;
    }
    if (/^#[0-9a-f]{6}$/.test(text)) {
      return text;
    }
    if (/^#[0-9a-f]{3}$/.test(text)) {
      return (
        "#" +
        text.charAt(1) +
        text.charAt(1) +
        text.charAt(2) +
        text.charAt(2) +
        text.charAt(3) +
        text.charAt(3)
      );
    }
    return "";
  }

  function normalizeOpacity(value) {
    var number = Number(value);
    if (number !== number) {
      return "";
    }
    if (number < OPACITY_MIN) {
      number = OPACITY_MIN;
    }
    if (number > OPACITY_MAX) {
      number = OPACITY_MAX;
    }
    return String(Math.round(number * 100) / 100);
  }

  function readLocal() {
    try {
      var store = window.localStorage;
      return (store && store.getItem(STORAGE_KEY)) || "";
    } catch {
      return "";
    }
  }

  function applyStoredRaw(raw) {
    if (!raw) {
      return;
    }
    try {
      var saved = typeof raw === "string" ? JSON.parse(raw) : raw;
      var color = normalizeColor(saved && saved.color);
      var opacity = normalizeOpacity(saved && saved.opacity);
      if (color) {
        CONFIG.color = color;
      }
      if (opacity) {
        CONFIG.opacity = opacity;
      }
      if (saved && saved.seenTip === true) {
        CONFIG.seenTip = true;
      }
    } catch {
      // Corrupt storage is ignored; defaults still work.
    }
  }

  function saveConfig() {
    var payload = JSON.stringify({
      color: CONFIG.color,
      opacity: CONFIG.opacity,
      seenTip: CONFIG.seenTip === true,
    });
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(STORAGE_KEY, payload);
      }
    } catch {
      // Fall through to localStorage.
    }
    try {
      if (typeof GM !== "undefined" && GM && typeof GM.setValue === "function") {
        GM.setValue(STORAGE_KEY, payload);
      }
    } catch {
      // Unpacked extension and the playground have no GM API.
    }
    try {
      if (window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, payload);
      }
    } catch {
      // Private mode still shows the highlight; it just will not remember.
    }
  }

  function saveSyncState() {
    var payload = JSON.stringify({
      enabled: syncEnabled === true,
      token: syncToken || "",
      email: syncEmail || "",
      cloudUpdatedAt: cloudUpdatedAt || "",
    });
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(SYNC_KEY, payload);
      }
    } catch {
      // Ignore.
    }
    try {
      if (typeof GM !== "undefined" && GM && typeof GM.setValue === "function") {
        GM.setValue(SYNC_KEY, payload);
      }
    } catch {
      // Ignore.
    }
  }

  function applySyncRaw(raw) {
    if (!raw) {
      return;
    }
    try {
      var saved = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!saved || typeof saved !== "object") {
        return;
      }
      syncEnabled = saved.enabled === true;
      syncToken = typeof saved.token === "string" ? saved.token : "";
      syncEmail = typeof saved.email === "string" ? saved.email : "";
      cloudUpdatedAt =
        typeof saved.cloudUpdatedAt === "string" ? saved.cloudUpdatedAt : "";
      if (!syncToken) {
        syncEnabled = false;
      }
    } catch {
      syncEnabled = false;
      syncToken = "";
    }
  }

  function loadSyncState() {
    try {
      if (typeof GM_getValue === "function") {
        applySyncRaw(GM_getValue(SYNC_KEY, "") || "");
        return;
      }
    } catch {
      // Try async GM next.
    }
    try {
      if (
        typeof GM !== "undefined" &&
        GM &&
        typeof GM.getValue === "function" &&
        typeof Promise !== "undefined"
      ) {
        Promise.resolve(GM.getValue(SYNC_KEY, "")).then(
          function (value) {
            applySyncRaw(value || "");
            syncPanel();
            if (syncEnabled && syncToken) {
              pullCloud();
            }
          },
          function () {}
        );
      }
    } catch {
      // Local-only.
    }
  }

  function gmXhr() {
    if (typeof GM_xmlhttpRequest === "function") {
      return GM_xmlhttpRequest;
    }
    if (typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function") {
      return GM.xmlHttpRequest;
    }
    return null;
  }

  function setSyncStatus(text) {
    syncStatus = text || "";
    syncPanel();
  }

  function disableCloud(message) {
    syncEnabled = false;
    syncToken = "";
    syncEmail = "";
    cloudUpdatedAt = "";
    saveSyncState();
    setSyncStatus(message || "Cloud sync is off. Local colour still works.");
  }

  function cloudUrl(path) {
    if (path.indexOf("/api/") !== 0) {
      return "";
    }
    return SYNC_ORIGIN + path;
  }

  function cloudRequest(method, path, body, headers, callback) {
    var xhr = gmXhr();
    var url = cloudUrl(path);
    if (!xhr || !url) {
      callback({ error: "unavailable" }, null, 0);
      return;
    }
    var reqHeaders = {
      accept: "application/json",
    };
    var key;
    if (headers) {
      for (key in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, key) && headers[key]) {
          reqHeaders[key] = headers[key];
        }
      }
    }
    if (body) {
      reqHeaders["content-type"] = "application/json";
    }
    xhr({
      method: method,
      url: url,
      headers: reqHeaders,
      data: body ? JSON.stringify(body) : undefined,
      timeout: SYNC_TIMEOUT_MS,
      anonymous: true,
      onload: function (response) {
        var status = Number(response && response.status) || 0;
        var text = (response && response.responseText) || "";
        var type = String((response && response.responseHeaders) || "").toLowerCase();
        var parsed = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            callback({ error: "invalid" }, null, status);
            return;
          }
        }
        if (text && type && type.indexOf("content-type") !== -1 && type.indexOf("json") === -1) {
          callback({ error: "invalid" }, null, status);
          return;
        }
        callback(null, parsed, status);
      },
      onerror: function () {
        callback({ error: "network" }, null, 0);
      },
      ontimeout: function () {
        callback({ error: "timeout" }, null, 0);
      },
    });
  }

  function authHeaders() {
    if (!syncToken) {
      return {};
    }
    return { authorization: "Bearer " + syncToken };
  }

  function applyCloudPayload(data) {
    var color = data && normalizeColor(data.color);
    var opacity = data && normalizeOpacity(data.opacity);
    if (!color || !opacity) {
      return false;
    }
    applyingCloud = true;
    applyConfig({ color: color, opacity: opacity });
    applyingCloud = false;
    if (typeof data.updatedAt === "string" && data.updatedAt) {
      cloudUpdatedAt = data.updatedAt;
      saveSyncState();
    }
    return true;
  }

  function pullCloud() {
    if (!syncEnabled || !syncToken || syncBusy) {
      return;
    }
    syncBusy = true;
    cloudRequest("GET", "/api/settings", null, authHeaders(), function (err, data, status) {
      syncBusy = false;
      if (status === 401) {
        disableCloud("Signed out on Focus Cell. Local colour kept.");
        return;
      }
      if (err || !data) {
        setSyncStatus("Could not reach Focus Cell. Using local colour.");
        return;
      }
      if (!applyCloudPayload(data)) {
        setSyncStatus("Ignored invalid cloud settings. Local colour kept.");
        return;
      }
      setSyncStatus(syncEmail ? "Synced as " + syncEmail : "Synced");
    });
  }

  function pushCloud() {
    if (!syncEnabled || !syncToken || applyingCloud || syncBusy) {
      return;
    }
    syncBusy = true;
    var body = {
      color: CONFIG.color,
      opacity: CONFIG.opacity,
    };
    if (cloudUpdatedAt) {
      body.baseUpdatedAt = cloudUpdatedAt;
    }
    cloudRequest("PUT", "/api/settings", body, authHeaders(), function (err, data, status) {
      syncBusy = false;
      if (status === 401) {
        disableCloud("Signed out on Focus Cell. Local colour kept.");
        return;
      }
      if (status === 409 && data && data.settings) {
        if (applyCloudPayload(data.settings)) {
          setSyncStatus("Cloud colour was newer. Applied it here.");
        }
        return;
      }
      if (err || status !== 200 || !data) {
        setSyncStatus("Could not save to Focus Cell. Local colour kept.");
        return;
      }
      if (typeof data.updatedAt === "string") {
        cloudUpdatedAt = data.updatedAt;
        saveSyncState();
      }
      setSyncStatus(syncEmail ? "Synced as " + syncEmail : "Synced");
    });
  }

  function scheduleCloudPush() {
    if (!syncEnabled || !syncToken || applyingCloud) {
      return;
    }
    if (cloudPushTimer && typeof window.clearTimeout === "function") {
      window.clearTimeout(cloudPushTimer);
    }
    if (typeof window.setTimeout !== "function") {
      pushCloud();
      return;
    }
    cloudPushTimer = window.setTimeout(pushCloud, 400);
  }

  function stopPolling() {
    if (pollTimer && typeof window.clearInterval === "function") {
      window.clearInterval(pollTimer);
    }
    pollTimer = 0;
  }

  function pollUntilReady(requestId, pollSecret) {
    var attempts = 0;
    stopPolling();
    function tick() {
      attempts += 1;
      if (attempts > 45) {
        stopPolling();
        setSyncStatus("Timed out waiting for approval. Local colour kept.");
        return;
      }
      cloudRequest(
        "POST",
        "/api/sync/poll",
        { requestId: requestId, pollSecret: pollSecret },
        null,
        function (err, data, status) {
          if (status === 404) {
            stopPolling();
            setSyncStatus("Sync request expired. Try Enable again.");
            return;
          }
          if (err || !data) {
            return;
          }
          if (data.status === "pending") {
            return;
          }
          if (data.status === "ready" && typeof data.token === "string" && data.token) {
            stopPolling();
            syncEnabled = true;
            syncToken = data.token;
            syncEmail = typeof data.email === "string" ? data.email : "";
            saveSyncState();
            setSyncStatus("Connected. Fetching account colour…");
            pullCloud();
          }
        }
      );
    }
    tick();
    if (typeof window.setInterval === "function") {
      pollTimer = window.setInterval(tick, 2000);
    }
  }

  function beginCloudSync() {
    var xhr = gmXhr();
    if (!xhr) {
      setSyncStatus("Tampermonkey is required to sync from Sheets. Local colour still works.");
      return;
    }
    setSyncStatus("Waiting for approval on Focus Cell…");
    cloudRequest("POST", "/api/sync/prepare", {}, null, function (err, data) {
      if (err || !data || !data.requestId || !data.pollSecret) {
        setSyncStatus("Could not start sync. Local colour kept.");
        return;
      }
      var path =
        typeof data.authorizePath === "string" && data.authorizePath.charAt(0) === "/"
          ? data.authorizePath
          : "/sync?request=" + encodeURIComponent(data.requestId);
      var href = SYNC_ORIGIN + path;
      if (syncOpen) {
        syncOpen.href = href;
        if (typeof syncOpen.click === "function") {
          syncOpen.click();
        }
      } else if (typeof window.open === "function") {
        window.open(href, "_blank", "noopener");
      }
      pollUntilReady(data.requestId, data.pollSecret);
    });
  }

  function loadStored(callback) {
    var finished = false;
    function done(raw) {
      if (finished) {
        return;
      }
      finished = true;
      applyStoredRaw(raw || readLocal());
      callback();
    }

    try {
      if (typeof GM_getValue === "function") {
        done(GM_getValue(STORAGE_KEY, "") || "");
        return;
      }
    } catch {
      // Try the async GM API next.
    }
    try {
      if (
        typeof GM !== "undefined" &&
        GM &&
        typeof GM.getValue === "function" &&
        typeof Promise !== "undefined"
      ) {
        Promise.resolve(GM.getValue(STORAGE_KEY, "")).then(
          function (value) {
            done(value || "");
          },
          function () {
            done("");
          }
        );
        return;
      }
    } catch {
      // localStorage only.
    }
    done(readLocal());
  }

  function applyConfig(next, persist) {
    var color = next && normalizeColor(next.color);
    var opacity = next && normalizeOpacity(next.opacity);
    if (color) {
      CONFIG.color = color;
    }
    if (opacity) {
      CONFIG.opacity = opacity;
    }
    if (persist !== false) {
      saveConfig();
      scheduleCloudPush();
    }
    signature = "";
    paintBands();
    syncPanel();
    if (document.body) {
      render();
    }
  }

  function paintBands() {
    var i;
    for (i = 0; i < bands.length; i++) {
      bands[i].style.backgroundColor = CONFIG.color;
      bands[i].style.opacity = CONFIG.opacity;
    }
  }

  function halt(event) {
    if (event.preventDefault) {
      event.preventDefault();
    }
    if (event.stopPropagation) {
      event.stopPropagation();
    }
  }

  function keepInPanel(event) {
    if (event.stopPropagation) {
      event.stopPropagation();
    }
  }

  function navInfo() {
    var nav =
      (typeof navigator !== "undefined" && navigator) ||
      (window && window.navigator) ||
      {};
    return {
      ua: String(nav.userAgent || ""),
      platform: String(nav.platform || ""),
    };
  }

  function shortcutLabel() {
    var info = navInfo();
    var mac = /Mac|iPhone|iPad/.test(info.platform) || /Mac OS/.test(info.ua);
    var firefox = /Firefox\//.test(info.ua);
    if (firefox) {
      return mac ? "Cmd+Shift+Period" : "Ctrl+Shift+Period";
    }
    return mac ? "Cmd+Shift+H" : "Ctrl+Shift+H";
  }

  function gridBox() {
    var node = grid();
    var base = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    if (base && base.width && base.height) {
      return base;
    }
    return {
      left: 0,
      top: 0,
      width: window.innerWidth || 1024,
      height: window.innerHeight || 768,
    };
  }

  function dismissTip() {
    if (CONFIG.seenTip) {
      return;
    }
    CONFIG.seenTip = true;
    saveConfig();
  }

  function chipTitle() {
    var node = grid();
    var ready = node && node.getBoundingClientRect && node.getBoundingClientRect().width;
    if (!ready) {
      return "Focus Cell colour chip. Open a sheet tab — the highlight attaches when the grid appears.";
    }
    if (!enabled) {
      return "Highlight colour is hidden. Click for options, or press " + shortcutLabel() + " to show it.";
    }
    return panelOpen
      ? "Close highlight colour"
      : "Highlight colour — click to change, no Tampermonkey edit needed. " +
          shortcutLabel() +
          " hides the bands.";
  }

  function commitHex() {
    var typed = hexInput.value;
    var color = normalizeColor(typed);
    if (color) {
      hexInput.style.borderColor = "#dadce0";
      applyConfig({ color: color });
      return;
    }
    hexInput.style.borderColor = "#d93025";
    hexInput.value = CONFIG.color;
  }

  function thumbLeft() {
    var span = OPACITY_MAX - OPACITY_MIN;
    var t = span ? (Number(CONFIG.opacity) - OPACITY_MIN) / span : 0;
    if (t < 0) {
      t = 0;
    }
    if (t > 1) {
      t = 1;
    }
    return Math.round(t * 144) + "px";
  }

  function syncPanel() {
    swatch.style.backgroundColor = CONFIG.color;
    swatch.style.opacity = enabled ? "1" : "0.45";
    picker.value = CONFIG.color;
    if (document.activeElement !== hexInput) {
      hexInput.value = CONFIG.color;
    }
    opacityThumb.style.left = thumbLeft();
    opacityValue.textContent = Math.round(Number(CONFIG.opacity) * 100) + "%";
    tray.style.display = panelOpen ? "flex" : "none";
    swatch.title = chipTitle();
    swatch.setAttribute("aria-expanded", panelOpen ? "true" : "false");
    toggleBtn.textContent = enabled ? "Hide highlight" : "Show highlight";
    toggleBtn.setAttribute(
      "aria-label",
      enabled ? "Hide highlight" : "Show highlight"
    );
    shortcutLine.textContent = "Hide shortcut: " + shortcutLabel();
    if (syncLine) {
      if (!syncEnabled) {
        syncLine.textContent = "Cloud sync: off";
      } else if (syncEmail) {
        syncLine.textContent = "Cloud sync: on · " + syncEmail;
      } else {
        syncLine.textContent = "Cloud sync: on";
      }
    }
    if (syncToggle) {
      syncToggle.textContent = syncEnabled ? "Turn off cloud sync" : "Enable cloud sync";
      syncToggle.setAttribute(
        "aria-label",
        syncEnabled ? "Turn off cloud sync" : "Enable cloud sync"
      );
    }
    if (syncNote) {
      syncNote.textContent =
        syncStatus ||
        (syncEnabled
          ? "Confirming account…"
          : "Optional. Sign in on Focus Cell, then enable. Colour still works locally.");
    }
    if (tip && tip.style) {
      tip.style.display = !CONFIG.seenTip && !panelOpen ? "block" : "none";
    }
    var i;
    for (i = 0; i < presetButtons.length; i++) {
      presetButtons[i].style.border =
        presetButtons[i].getAttribute("data-color") === CONFIG.color
          ? "2px solid #202124"
          : "1px solid #dadce0";
    }
  }

  function opacityFromPointer(event) {
    var box = opacityTrack.getBoundingClientRect();
    if (!box.width) {
      return;
    }
    var t = (event.clientX - box.left) / box.width;
    applyConfig({
      opacity: OPACITY_MIN + t * (OPACITY_MAX - OPACITY_MIN),
    });
  }

  function setPanelOpen(open) {
    panelOpen = open;
    if (open) {
      dismissTip();
      if (syncEnabled && syncToken) {
        pullCloud();
      }
    }
    syncPanel();
    placePanel(gridBox());
  }

  function placePanel(base) {
    if (!panel.parentNode && document.body) {
      document.body.appendChild(panel);
    }
    if (!base || !base.width || !base.height) {
      base = gridBox();
    }
    var tipVisible = !CONFIG.seenTip && !panelOpen;
    var width = panelOpen ? 260 : 36;
    var height = panelOpen ? 420 : tipVisible ? 92 : 36;
    Object.assign(panel.style, {
      display: "flex",
      position: "fixed",
      zIndex: "10000",
      left: Math.max(8, base.left + base.width - width - 8) + "px",
      top: Math.max(8, base.top + base.height - height - 8) + "px",
    });
  }

  function buildPanel() {
    Object.assign(panel.style, {
      display: "none",
      flexDirection: "column",
      alignItems: "flex-end",
      gap: "8px",
      pointerEvents: "auto",
      fontFamily: "Arial, sans-serif",
    });

    Object.assign(swatch.style, {
      width: "28px",
      height: "28px",
      padding: "0",
      border: "2px solid #fff",
      borderRadius: "50%",
      boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
      cursor: "pointer",
      backgroundColor: CONFIG.color,
    });
    swatch.type = "button";
    swatch.setAttribute("aria-label", "Highlight colour");
    swatch.addEventListener("click", function (event) {
      halt(event);
      setPanelOpen(!panelOpen);
    });
    swatch.addEventListener("mousedown", halt);

    Object.assign(tray.style, {
      display: "none",
      flexDirection: "column",
      gap: "8px",
      padding: "10px",
      background: "#fff",
      border: "1px solid #dadce0",
      borderRadius: "8px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
      minWidth: "228px",
    });
    tray.addEventListener("mousedown", keepInPanel);
    tray.addEventListener("click", keepInPanel);

    var label = document.createElement("div");
    Object.assign(label.style, {
      fontSize: "11px",
      fontWeight: "600",
      color: "#3c4043",
    });
    label.textContent = "Highlight colour";

    var row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      flexWrap: "wrap",
    });

    var i;
    var chip;
    for (i = 0; i < PRESETS.length; i++) {
      chip = document.createElement("button");
      chip.type = "button";
      chip.setAttribute("data-color", PRESETS[i]);
      chip.setAttribute("aria-label", "Use " + PRESETS[i]);
      Object.assign(chip.style, {
        width: "18px",
        height: "18px",
        padding: "0",
        border:
          PRESETS[i] === CONFIG.color ? "2px solid #202124" : "1px solid #dadce0",
        borderRadius: "50%",
        backgroundColor: PRESETS[i],
        cursor: "pointer",
      });
      chip.addEventListener(
        "click",
        (function (color) {
          return function (event) {
            halt(event);
            applyConfig({ color: color });
          };
        })(PRESETS[i])
      );
      presetButtons.push(chip);
      row.appendChild(chip);
    }

    picker.type = "color";
    picker.value = CONFIG.color;
    picker.title = "Custom colour";
    Object.assign(picker.style, {
      width: "28px",
      height: "22px",
      padding: "0",
      border: "1px solid #dadce0",
      background: "#fff",
      cursor: "pointer",
    });
    picker.addEventListener("input", function () {
      applyConfig({ color: picker.value });
    });
    picker.addEventListener("change", function () {
      applyConfig({ color: picker.value });
    });
    picker.addEventListener("mousedown", keepInPanel);
    row.appendChild(picker);

    hexInput.type = "text";
    hexInput.value = CONFIG.color;
    hexInput.maxLength = 7;
    hexInput.spellcheck = false;
    hexInput.setAttribute("aria-label", "Hex colour");
    hexInput.placeholder = "#1a73e8";
    Object.assign(hexInput.style, {
      width: "100%",
      boxSizing: "border-box",
      padding: "4px 6px",
      border: "1px solid #dadce0",
      borderRadius: "4px",
      fontFamily: "ui-monospace, Consolas, monospace",
      fontSize: "12px",
      color: "#202124",
    });
    hexInput.addEventListener("keydown", function (event) {
      keepInPanel(event);
      if (event.key === "Enter") {
        commitHex();
        if (event.preventDefault) {
          event.preventDefault();
        }
      }
    });
    hexInput.addEventListener("keyup", keepInPanel);
    hexInput.addEventListener("change", commitHex);
    hexInput.addEventListener("blur", commitHex);

    var opacityRow = document.createElement("div");
    Object.assign(opacityRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "11px",
      color: "#5f6368",
    });
    var opacityCaption = document.createElement("span");
    opacityCaption.textContent = "Opacity";
    Object.assign(opacityTrack.style, {
      position: "relative",
      flex: "1",
      height: "10px",
      borderRadius: "5px",
      background: "#e8eaed",
      cursor: "pointer",
      minWidth: "120px",
    });
    opacityTrack.setAttribute("role", "slider");
    opacityTrack.setAttribute("aria-label", "Highlight opacity");
    Object.assign(opacityThumb.style, {
      position: "absolute",
      top: "-4px",
      width: "16px",
      height: "16px",
      borderRadius: "50%",
      background: "#1a73e8",
      border: "2px solid #fff",
      boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
      pointerEvents: "none",
      left: thumbLeft(),
    });
    opacityTrack.appendChild(opacityThumb);
    Object.assign(opacityValue.style, {
      width: "32px",
      textAlign: "right",
      fontVariantNumeric: "tabular-nums",
      color: "#3c4043",
    });
    opacityValue.textContent = Math.round(Number(CONFIG.opacity) * 100) + "%";
    opacityRow.appendChild(opacityCaption);
    opacityRow.appendChild(opacityTrack);
    opacityRow.appendChild(opacityValue);

    opacityTrack.addEventListener("mousedown", function (event) {
      keepInPanel(event);
      if (event.preventDefault) {
        event.preventDefault();
      }
      opacityDragging = true;
      opacityFromPointer(event);
    });

    var hint = document.createElement("div");
    Object.assign(hint.style, {
      fontSize: "10px",
      color: "#80868b",
      lineHeight: "1.35",
    });
    hint.textContent =
      "Hex and opacity are saved in this browser (and Tampermonkey). Refresh keeps them. Cloud sync is optional.";

    toggleBtn.type = "button";
    toggleBtn.setAttribute("aria-label", "Hide highlight");
    toggleBtn.textContent = "Hide highlight";
    Object.assign(toggleBtn.style, {
      width: "100%",
      boxSizing: "border-box",
      margin: "0",
      padding: "6px 8px",
      border: "1px solid #dadce0",
      borderRadius: "4px",
      background: "#f8f9fa",
      color: "#202124",
      fontSize: "12px",
      cursor: "pointer",
    });
    toggleBtn.addEventListener("click", function (event) {
      halt(event);
      enabled = !enabled;
      syncPanel();
      render();
    });
    toggleBtn.addEventListener("mousedown", halt);

    Object.assign(shortcutLine.style, {
      fontSize: "10px",
      color: "#80868b",
      lineHeight: "1.35",
    });
    shortcutLine.textContent = "Hide shortcut: " + shortcutLabel();

    syncLine = document.createElement("div");
    Object.assign(syncLine.style, {
      fontSize: "11px",
      color: "#3c4043",
      lineHeight: "1.35",
    });
    syncLine.setAttribute("aria-label", "Cloud sync state");

    syncToggle = document.createElement("button");
    syncToggle.type = "button";
    syncToggle.setAttribute("aria-label", "Enable cloud sync");
    syncToggle.textContent = "Enable cloud sync";
    Object.assign(syncToggle.style, {
      width: "100%",
      boxSizing: "border-box",
      margin: "0",
      padding: "6px 8px",
      border: "1px solid #dadce0",
      borderRadius: "4px",
      background: "#fff",
      color: "#202124",
      fontSize: "12px",
      cursor: "pointer",
    });
    syncToggle.addEventListener("click", function (event) {
      halt(event);
      if (syncEnabled) {
        stopPolling();
        disableCloud("Cloud sync is off. Local colour still works.");
        return;
      }
      beginCloudSync();
    });
    syncToggle.addEventListener("mousedown", halt);

    syncOpen = document.createElement("a");
    syncOpen.setAttribute("aria-label", "Open Focus Cell sign-in");
    syncOpen.textContent = "Open Focus Cell sign-in";
    syncOpen.href = SYNC_ORIGIN + "/api/auth/google?next=/sync";
    syncOpen.target = "_blank";
    syncOpen.rel = "noopener noreferrer";
    Object.assign(syncOpen.style, {
      fontSize: "11px",
      color: "#137333",
      textDecoration: "underline",
    });
    syncOpen.addEventListener("mousedown", keepInPanel);
    syncOpen.addEventListener("click", keepInPanel);

    syncNote = document.createElement("div");
    Object.assign(syncNote.style, {
      fontSize: "10px",
      color: "#80868b",
      lineHeight: "1.35",
    });
    syncNote.setAttribute("role", "status");
    syncNote.setAttribute("aria-label", "Cloud sync status");

    tip.id = "sheets-focus-cell-tip";
    tip.setAttribute("aria-label", "How to change the highlight colour");
    Object.assign(tip.style, {
      display: "none",
      maxWidth: "220px",
      padding: "8px 10px",
      background: "#202124",
      color: "#fff",
      fontSize: "11px",
      lineHeight: "1.4",
      borderRadius: "8px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
    });
    tip.textContent =
      "Click the chip to change colour. You never edit Tampermonkey for this.";

    tray.appendChild(label);
    tray.appendChild(row);
    tray.appendChild(hexInput);
    tray.appendChild(opacityRow);
    tray.appendChild(toggleBtn);
    tray.appendChild(shortcutLine);
    tray.appendChild(hint);
    tray.appendChild(syncLine);
    tray.appendChild(syncToggle);
    tray.appendChild(syncOpen);
    tray.appendChild(syncNote);
    panel.appendChild(tray);
    panel.appendChild(tip);
    panel.appendChild(swatch);
    syncPanel();
  }

  function grid() {
    return document.getElementById(GRID_ID);
  }

  /**
   * Both hooks are queried inside the grid, never document-wide. "selection"
   * is a plausible class name for unrelated parts of a page this large, and a
   * stray match would draw a band over nothing.
   */
  function visible(node, className) {
    var all = node.getElementsByClassName(className);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].style.display !== "none") {
        out.push(all[i]);
      }
    }
    return out;
  }

  function toRect(box, base) {
    return {
      x: box.left - base.left,
      y: box.top - base.top,
      width: box.width,
      height: box.height,
    };
  }

  /**
   * Sheets draws a whole-row or whole-column pick as a rect that overflows the
   * grid, and already tints it edge to edge itself. Those picks and any cell
   * sitting inside one are dropped, so we never double-darken what Sheets has
   * already coloured. A whole-row pick therefore adds no band of its own,
   * which is intended: the row is already highlighted.
   */
  function selectionRects(elements, base) {
    var rects = elements.map(function (element) {
      return toRect(element.getBoundingClientRect(), base);
    });

    var spans = rects.filter(function (rect) {
      return base.width < rect.width || base.height < rect.height;
    });

    return rects.filter(function (rect) {
      return !spans.some(function (span) {
        return span.height < span.width
          ? rect.y === span.y && rect.height === span.height
          : rect.x === span.x && rect.width === span.width;
      });
    });
  }

  /**
   * The outline of one cell is four elements: top, right, bottom, left. Their
   * union is the cell. Taking them in fours rather than insisting on exactly
   * four means a frozen pane adding a second set degrades into two rects that
   * the merge step folds together, instead of switching the highlight off.
   */
  function activeCellRects(elements, base) {
    var rects = [];
    var i;
    var j;
    var box;
    var left;
    var top;
    var right;
    var bottom;

    for (i = 0; i + 4 <= elements.length; i += 4) {
      left = Infinity;
      top = Infinity;
      right = -Infinity;
      bottom = -Infinity;
      for (j = i; j < i + 4; j++) {
        box = elements[j].getBoundingClientRect();
        if (!box.width && !box.height) {
          continue;
        }
        left = Math.min(left, box.left);
        top = Math.min(top, box.top);
        right = Math.max(right, box.right);
        bottom = Math.max(bottom, box.bottom);
      }
      if (left < right && top < bottom) {
        rects.push(
          toRect(
            {
              left: left,
              top: top,
              width: right - left,
              height: bottom - top,
            },
            base
          )
        );
      }
    }

    return rects;
  }

  function targetRects(node, base) {
    var selections = visible(node, SELECTION_CLASS);
    if (selections.length) {
      return selectionRects(selections, base);
    }
    return activeCellRects(visible(node, ACTIVE_BORDER_CLASS), base);
  }

  /** Collapse touching or overlapping rects so opacity stays even. */
  function merge(rects, axis) {
    var size = axis === "x" ? "width" : "height";
    return rects
      .slice()
      .sort(function (a, b) {
        return a[axis] - b[axis];
      })
      .reduce(function (acc, rect) {
        var prev = acc[acc.length - 1];
        if (!prev || prev.start + prev.size < rect[axis]) {
          acc.push({ start: rect[axis], size: rect[size] });
          return acc;
        }
        prev.size = Math.max(prev.size, rect[axis] + rect[size] - prev.start);
        return acc;
      }, []);
  }

  function bandStyles(node, base) {
    var rects = targetRects(node, base);
    var styles = [];
    var i;
    var run;

    if (CONFIG.row) {
      run = merge(rects, "y");
      for (i = 0; i < run.length; i++) {
        styles.push({
          left: "0px",
          top: run[i].start + "px",
          width: "100%",
          height: run[i].size + "px",
        });
      }
    }

    if (CONFIG.column) {
      run = merge(rects, "x");
      for (i = 0; i < run.length; i++) {
        styles.push({
          left: run[i].start + "px",
          top: "0px",
          width: run[i].size + "px",
          height: "100%",
        });
      }
    }

    return styles;
  }

  function hide() {
    if (signature === "off") {
      return;
    }
    signature = "off";
    overlay.style.display = "none";
  }

  function render() {
    // Sheets owns document.body. Checking before the no-change shortcut below
    // matters: otherwise a detached overlay is never put back.
    if (!overlay.parentNode) {
      document.body.appendChild(overlay);
      signature = "";
    }
    if (!panel.parentNode) {
      document.body.appendChild(panel);
    }

    var node = grid();
    var base = node ? node.getBoundingClientRect() : null;
    var ready = base && base.width && base.height;
    // Keep the colour chip on screen even before the grid paints, so a first
    // install is not silent on the Sheets start page or while the tab loads.
    placePanel(ready ? base : gridBox());
    if (!ready) {
      hide();
      return;
    }

    if (!enabled) {
      hide();
      return;
    }

    var styles = bandStyles(node, base);
    var next = JSON.stringify([
      base.left,
      base.top,
      base.width,
      base.height,
      CONFIG.color,
      CONFIG.opacity,
      styles,
    ]);
    if (next === signature) {
      return;
    }
    signature = next;

    Object.assign(overlay.style, {
      display: "block",
      position: "fixed",
      pointerEvents: "none",
      overflow: "hidden",
      zIndex: "1",
      left: base.left + "px",
      top: base.top + "px",
      width: base.width + "px",
      height: base.height + "px",
    });

    while (bands.length < styles.length) {
      var band = document.createElement("div");
      bands.push(band);
      overlay.appendChild(band);
    }

    for (var i = 0; i < bands.length; i++) {
      if (i >= styles.length) {
        bands[i].style.display = "none";
        continue;
      }
      Object.assign(
        bands[i].style,
        {
          position: "absolute",
          pointerEvents: "none",
          display: "block",
          backgroundColor: CONFIG.color,
          opacity: CONFIG.opacity,
        },
        styles[i]
      );
    }
  }

  function nextFrame(callback) {
    var raf =
      window.requestAnimationFrame ||
      window.webkitRequestAnimationFrame ||
      window.mozRequestAnimationFrame;
    if (typeof raf === "function") {
      raf.call(window, callback);
      return;
    }
    window.setTimeout(callback, 16);
  }

  /** Coalesce bursts of scroll, typing, and mutations into one paint. */
  function schedule() {
    if (queued) {
      return;
    }
    queued = true;
    nextFrame(function () {
      queued = false;
      watchGrid();
      render();
    });
  }

  /**
   * Chrome, Edge, Safari: Ctrl+Shift+H (Cmd+Shift+H on a Mac). Firefox binds
   * Ctrl+Shift+H to the History library at the chrome level, so the page never
   * sees it — Ctrl+Shift+Period is the fallback there. `event.code` is missing
   * in some Firefox builds, so `event.key` is the second check. metaKey covers
   * Edge and Chrome on a Mac. Alt is ignored so AltGr (Ctrl+Alt) cannot fire it.
   */
  function isToggleShortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) {
      return false;
    }
    if (event.altKey) {
      return false;
    }
    var code = event.code || "";
    var key = String(event.key || "").toLowerCase();
    if (code === "KeyH" || key === "h") {
      return true;
    }
    return code === "Period" || key === "." || key === ">";
  }

  function onKeyDown(event) {
    if (event.target === hexInput) {
      return;
    }
    if (panelOpen && (event.key === "Escape" || event.code === "Escape")) {
      setPanelOpen(false);
      halt(event);
      return;
    }
    if (isToggleShortcut(event)) {
      enabled = !enabled;
      halt(event);
      syncPanel();
      render();
      return;
    }
    schedule();
  }

  function onOpacityMove(event) {
    if (!opacityDragging) {
      return;
    }
    keepInPanel(event);
    opacityFromPointer(event);
  }

  function onOpacityUp(event) {
    if (!opacityDragging) {
      return;
    }
    keepInPanel(event);
    opacityDragging = false;
    opacityFromPointer(event);
  }

  function onCaptureClick(event) {
    if (panelOpen) {
      var node = event.target;
      var inside = false;
      while (node) {
        if (node === panel) {
          inside = true;
          break;
        }
        node = node.parentNode;
      }
      if (!inside) {
        setPanelOpen(false);
      }
    }
    schedule();
  }

  /**
   * Sheets also moves the selection without a click or a keypress: the name
   * box, Find, and collaborators all do it. Watching the outline elements
   * covers those. Switching tabs can replace the whole grid, so re-attach
   * whenever the element we were watching is gone.
   */
  function watchGrid() {
    var node = grid();
    if (!node || node === observed || typeof MutationObserver !== "function") {
      return;
    }
    if (observer) {
      observer.disconnect();
    }
    observed = node;
    observer = new MutationObserver(schedule);
    observer.observe(node, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["style", "class"],
    });
  }

  function start() {
    loadStored(function () {
      loadSyncState();
      buildPanel();
      document.body.appendChild(overlay);
      document.body.appendChild(panel);
      window.addEventListener("click", onCaptureClick, true);
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("keyup", schedule, true);
      window.addEventListener("scroll", schedule, true);
      window.addEventListener("resize", schedule);
      window.addEventListener("mousemove", onOpacityMove, true);
      window.addEventListener("mouseup", onOpacityUp, true);
      window.addEventListener("sheets-focus-cell:set", function (event) {
        applyConfig(event.detail || {});
      });
      watchGrid();
      render();
      if (syncEnabled && syncToken) {
        pullCloud();
      }
    });
  }

  if (document.body) {
    start();
  } else {
    window.addEventListener("DOMContentLoaded", start);
  }
})();
