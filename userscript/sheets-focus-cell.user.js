// ==UserScript==
// @name         Focus Cell for Google Sheets
// @namespace    https://github.com/sheets-focus-cell
// @version      1.3.0
// @description  Excel-style active row and column highlight in Google Sheets, drawn in the browser so there is no Apps Script delay.
// @author       sheets-focus-cell
// @match        https://docs.google.com/spreadsheets/*
// @include      https://docs.google.com/spreadsheets/*
// @run-at       document-idle
// @grant        none
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

  var STORAGE_KEY = "sheets-focus-cell";
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
  var opacityInput = document.createElement("input");
  var tray = document.createElement("div");
  var presetButtons = [];
  var bands = [];
  var enabled = true;
  var queued = false;
  var signature = "";
  var observer = null;
  var observed = null;
  var panelOpen = false;

  function normalizeColor(value) {
    var text = String(value || "")
      .trim()
      .toLowerCase();
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
    if (!(number > 0) || number > 0.5) {
      return "";
    }
    return String(Math.round(number * 100) / 100);
  }

  function saveConfig() {
    try {
      var store = window.localStorage;
      if (!store) {
        return;
      }
      store.setItem(
        STORAGE_KEY,
        JSON.stringify({
          color: CONFIG.color,
          opacity: CONFIG.opacity,
        })
      );
    } catch {
      // Same as load: the highlight still works, it just will not remember.
    }
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

  function loadConfig() {
    try {
      var store = window.localStorage;
      var raw = store && store.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      var saved = JSON.parse(raw);
      var color = normalizeColor(saved.color);
      var opacity = normalizeOpacity(saved.opacity);
      if (color) {
        CONFIG.color = color;
      }
      if (opacity) {
        CONFIG.opacity = opacity;
      }
    } catch {
      // Private mode and blocked storage both throw. Defaults still work.
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

  function syncPanel() {
    swatch.style.backgroundColor = CONFIG.color;
    picker.value = CONFIG.color;
    opacityInput.value = CONFIG.opacity;
    tray.style.display = panelOpen ? "flex" : "none";
    swatch.title = panelOpen
      ? "Close highlight colour"
      : "Highlight colour — click to change, no Tampermonkey edit needed";
    var i;
    for (i = 0; i < presetButtons.length; i++) {
      presetButtons[i].style.border =
        presetButtons[i].getAttribute("data-color") === CONFIG.color
          ? "2px solid #202124"
          : "1px solid #dadce0";
    }
  }

  function setPanelOpen(open) {
    panelOpen = open;
    syncPanel();
    var node = grid();
    var base = node ? node.getBoundingClientRect() : null;
    placePanel(base && base.width && base.height ? base : null);
  }

  function placePanel(base) {
    if (!panel.parentNode && document.body) {
      document.body.appendChild(panel);
    }
    if (!base) {
      panel.style.display = "none";
      return;
    }
    var width = panelOpen ? 228 : 36;
    var height = panelOpen ? 132 : 36;
    Object.assign(panel.style, {
      display: "flex",
      position: "fixed",
      zIndex: "3",
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
      minWidth: "200px",
    });
    tray.addEventListener("mousedown", halt);
    tray.addEventListener("click", halt);

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
    row.appendChild(picker);

    var opacityRow = document.createElement("label");
    Object.assign(opacityRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "11px",
      color: "#5f6368",
    });
    opacityRow.textContent = "Opacity";
    opacityInput.type = "range";
    opacityInput.min = "0.04";
    opacityInput.max = "0.35";
    opacityInput.step = "0.01";
    opacityInput.value = CONFIG.opacity;
    Object.assign(opacityInput.style, { flex: "1" });
    opacityInput.addEventListener("input", function () {
      applyConfig({ opacity: opacityInput.value });
    });
    opacityRow.appendChild(opacityInput);

    var hint = document.createElement("div");
    Object.assign(hint.style, {
      fontSize: "10px",
      color: "#80868b",
      lineHeight: "1.35",
    });
    hint.textContent = "Saved in this browser. You do not edit Tampermonkey.";

    tray.appendChild(label);
    tray.appendChild(row);
    tray.appendChild(opacityRow);
    tray.appendChild(hint);
    panel.appendChild(tray);
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
    // A grid with no size means the spreadsheet has not painted yet.
    if (!base || !base.width || !base.height) {
      hide();
      placePanel(null);
      return;
    }
    placePanel(base);

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
    if (panelOpen && (event.key === "Escape" || event.code === "Escape")) {
      setPanelOpen(false);
      halt(event);
      return;
    }
    if (isToggleShortcut(event)) {
      enabled = !enabled;
      halt(event);
      render();
      return;
    }
    schedule();
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
    loadConfig();
    buildPanel();
    document.body.appendChild(overlay);
    document.body.appendChild(panel);
    window.addEventListener("click", onCaptureClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", schedule, true);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("sheets-focus-cell:set", function (event) {
      applyConfig(event.detail || {});
    });
    watchGrid();
    render();
  }

  if (document.body) {
    start();
  } else {
    window.addEventListener("DOMContentLoaded", start);
  }
})();
