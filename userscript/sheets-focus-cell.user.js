// ==UserScript==
// @name         Focus Cell for Google Sheets
// @namespace    https://github.com/sheets-focus-cell
// @version      1.5.0
// @description  Excel-style active row and column highlight in Google Sheets, drawn in the browser so there is no Apps Script delay.
// @author       sheets-focus-cell
// @match        https://docs.google.com/spreadsheets/*
// @include      https://docs.google.com/spreadsheets/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
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
    var nav = {};
    try {
      nav =
        (typeof navigator !== "undefined" && navigator) ||
        (window && window.navigator) ||
        {};
    } catch (err) {
      nav = {};
    }
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
    var height = panelOpen ? 252 : tipVisible ? 92 : 36;
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
      "Hex and opacity are saved in this browser (and Tampermonkey). Refresh keeps them.";

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
    });
  }

  if (document.body) {
    start();
  } else {
    window.addEventListener("DOMContentLoaded", start);
  }
})();
