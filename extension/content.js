// ==UserScript==
// @name         Focus Cell for Google Sheets
// @namespace    https://github.com/sheets-focus-cell
// @version      1.2.0
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
  var bands = [];
  var enabled = true;
  var queued = false;
  var signature = "";
  var observer = null;
  var observed = null;

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

    var node = enabled ? grid() : null;
    var base = node ? node.getBoundingClientRect() : null;
    // A grid with no size means the spreadsheet has not painted yet.
    if (!base || !base.width || !base.height) {
      hide();
      return;
    }

    var styles = bandStyles(node, base);
    var next = JSON.stringify([base.left, base.top, base.width, base.height, styles]);
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
    if (isToggleShortcut(event)) {
      enabled = !enabled;
      if (event.preventDefault) {
        event.preventDefault();
      }
      if (event.stopPropagation) {
        event.stopPropagation();
      }
      render();
      return;
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
    document.body.appendChild(overlay);
    window.addEventListener("click", schedule, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", schedule, true);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    watchGrid();
    render();
  }

  if (document.body) {
    start();
  } else {
    window.addEventListener("DOMContentLoaded", start);
  }
})();
