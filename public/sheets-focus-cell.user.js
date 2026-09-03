// ==UserScript==
// @name         Focus Cell for Google Sheets
// @namespace    https://github.com/sheets-focus-cell
// @version      1.0.0
// @description  Excel-style active row and column highlight in Google Sheets, drawn in the browser so there is no Apps Script delay.
// @author       sheets-focus-cell
// @match        https://docs.google.com/spreadsheets/d/*
// @run-at       document-idle
// @grant        none
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

  function gridRect() {
    var grid = document.getElementById(GRID_ID);
    return grid ? grid.getBoundingClientRect() : null;
  }

  function visibleSelections() {
    var all = document.getElementsByClassName(SELECTION_CLASS);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].style.display !== "none") {
        out.push(all[i]);
      }
    }
    return out;
  }

  /**
   * A whole-row or whole-column selection is drawn as a band wider or taller
   * than the grid, plus a cell-sized rect for the current cell. Highlighting
   * both would double-darken, so drop the cell that sits inside a band.
   */
  function selectionRects(elements, grid) {
    var rects = elements.map(function (element) {
      var box = element.getBoundingClientRect();
      return {
        x: box.x - grid.x,
        y: box.y - grid.y,
        width: box.width,
        height: box.height,
      };
    });

    var bandRects = rects.filter(function (rect) {
      return grid.width < rect.width || grid.height < rect.height;
    });

    return rects.filter(function (rect) {
      return !bandRects.some(function (band) {
        return band.height < band.width
          ? rect.y === band.y && rect.height === band.height
          : rect.x === band.x && rect.width === band.width;
      });
    });
  }

  /** The active cell outline is four elements: top, right, bottom, left. */
  function activeCellRect(grid) {
    var borders = document.getElementsByClassName(ACTIVE_BORDER_CLASS);
    if (borders.length !== 4) {
      return [];
    }
    var top = borders[0].getBoundingClientRect();
    var left = borders[3].getBoundingClientRect();
    return [
      {
        x: top.x - grid.x,
        y: top.y - grid.y,
        width: top.width,
        height: left.height,
      },
    ];
  }

  function targetRects(grid) {
    var selections = visibleSelections();
    if (selections.length) {
      return selectionRects(selections, grid);
    }
    return activeCellRect(grid);
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
        if (!prev || prev[axis] + prev[size] < rect[axis]) {
          acc.push({ start: rect[axis], size: rect[size] });
          return acc;
        }
        prev.size = Math.max(prev.size, rect[axis] + rect[size] - prev.start);
        return acc;
      }, []);
  }

  function bandStyles(grid) {
    var rects = targetRects(grid);
    var styles = [];
    var i;

    if (CONFIG.row) {
      var rows = merge(rects, "y");
      for (i = 0; i < rows.length; i++) {
        styles.push({
          left: "0px",
          top: rows[i].start + "px",
          width: "100%",
          height: rows[i].size + "px",
        });
      }
    }

    if (CONFIG.column) {
      var cols = merge(rects, "x");
      for (i = 0; i < cols.length; i++) {
        styles.push({
          left: cols[i].start + "px",
          top: "0px",
          width: cols[i].size + "px",
          height: "100%",
        });
      }
    }

    return styles;
  }

  function render() {
    var grid = enabled ? gridRect() : null;
    if (!grid) {
      overlay.style.display = "none";
      return;
    }

    Object.assign(overlay.style, {
      display: "block",
      position: "fixed",
      pointerEvents: "none",
      overflow: "hidden",
      zIndex: "1",
      left: grid.x + "px",
      top: grid.y + "px",
      width: grid.width + "px",
      height: grid.height + "px",
    });

    var styles = bandStyles(grid);
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

  /** Coalesce bursts of scroll and keydown into one paint per frame. */
  function schedule() {
    if (queued) {
      return;
    }
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      render();
    });
  }

  function onKeyDown(event) {
    if (event.ctrlKey && event.shiftKey && event.code === "KeyH") {
      enabled = !enabled;
      event.preventDefault();
      render();
      return;
    }
    schedule();
  }

  /**
   * Sheets also moves the selection without a click or a keypress: the name
   * box, Find, and collaborators all do it. Watching the outline elements
   * covers those. Bursts collapse into one paint per frame.
   */
  function watchGrid() {
    var grid = document.getElementById(GRID_ID);
    if (!grid || typeof MutationObserver !== "function") {
      return;
    }
    new MutationObserver(schedule).observe(grid, {
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
