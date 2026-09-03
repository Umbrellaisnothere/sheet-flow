# Focus Cell for Google Sheets

Excel highlights the active row and column and clears the highlight when you move. Google Sheets has no equivalent, and the usual Apps Script answer is slow enough to be unusable.

This project ships the highlight as a **browser userscript** that draws over the grid with no server round trip, plus an Apps Script file for **Move Visible Records** on filtered data.

## Why Apps Script cannot do this quickly

`onSelectionChange` is a server-side simple trigger. Every click has to reach Google, start a script container, change the document, and come back. That round trip is the delay, and it is not something the script body can influence — measured attempts here ran from four to nearly nine seconds depending on how much work the trigger did.

Google's own documentation also states that when several selection changes happen within two seconds of each other, only the first and last fire the trigger. Fast clicking is deliberately dropped to keep latency down, so the highlight lags behind where you actually are.

Three approaches were tried server-side, each slower than it looks:

| Approach | Why it disappoints |
| --- | --- |
| `setBackground` on the whole row | Never restores the previous row, so highlight sticks, and it destroys real fill colours |
| Hidden helper cells plus a `ROW()`/`COLUMN()` rule | Writing a value makes the tab recalculate and re-evaluate the rule over every covered cell — the ~9s case |
| Save and restore backgrounds around the cursor | Two colour reads and two colour writes per click, on top of the trigger cost |

The remaining server-side option is to write nothing at all, which is what `apps-script/Code.gs` now does. It moves one conditional-format rule onto the selected rows and columns. The rule's formula is the constant `="focuscell"="focuscell"`, so no cell is read and nothing recalculates, and because conditional formatting is an overlay your own fills are never touched. That lands around one to three seconds. Better, still not instant, and the trigger floor means it never will be.

## What actually solves it

Draw the highlight in the browser instead. Sheets renders the grid to canvas but keeps the selection outline as real positioned elements, so a small script can read where the cursor is and lay two translucent bands over the grid on the same frame as the click.

- No server round trip, so no delay
- Never edits the spreadsheet, so it cannot overwrite a fill or trigger a recalculation
- No Apps Script quota, no per-sheet enabling, works on every tab
- Handles multi-cell, whole-row, and whole-column picks

This is also what the established tools in this space do, including matsu7089's [Sheets Row Highlighter](https://github.com/matsu7089/sheets-row-highlighter), whose DOM approach this implementation follows.

### Install

**Tampermonkey** (Chrome, Edge, Firefox): install [Tampermonkey](https://www.tampermonkey.net/), create a new script, replace the template with [`userscript/sheets-focus-cell.user.js`](userscript/sheets-focus-cell.user.js), save, and reload your spreadsheet.

**Unpacked extension** (Chrome, Edge): open `chrome://extensions`, turn on Developer mode, choose Load unpacked, and select the [`extension/`](extension) folder.

`Ctrl+Shift+H` toggles the highlight. Colour, opacity, and whether to draw the row, the column, or both live in the `CONFIG` block at the top of the file.

## Move Visible Records

This one belongs in Apps Script: it is a deliberate menu action, so a second of latency does not matter.

1. In the spreadsheet you are using, open **Extensions → Apps Script**.
2. Replace **the entire** `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs) and Save.
3. Reload the spreadsheet, filter a column, select **one** source column, then **Excel Tools → Move Visible Records…**.

It reads the source and destination once, walks the arrays in memory, then writes each column once and skips the writes entirely if nothing moved. Rows hidden by a filter are skipped, occupied destination cells are left alone, and the selection jumps to the destination so the emptied source is not left selected. The common version of this function calls `setValue` once per row, which is hundreds of round trips.

## Try it locally

```bash
npm install
npm run build
npm start
```

- `/` — spreadsheet playground with the crosshair, a filter, and the move
- `/instant` — the userscript running against a mock of the Sheets DOM
- `/script` — copy or download `Code.gs`

The mock publishes the same three hooks the real grid does (`#waffle-grid-container`, four `.active-cell-border` elements, `.selection` rectangles), and the page loads the exact file you install, so the behaviour on that page is the behaviour you get in Sheets.

```bash
npm test    # engine rules, plus guards on both scripts
npm run sync    # refresh the published copies after editing a source file
```

## Files

| Path | Purpose |
| --- | --- |
| `userscript/sheets-focus-cell.user.js` | The instant highlighter. Source of truth |
| `extension/` | Manifest plus a synced copy of the same file |
| `apps-script/Code.gs` | Move Visible Records, and the slower server-side highlight |
| `apps-script/appsscript.json` | V8 runtime and spreadsheet scopes |
| `src/components/sheets-dom-mock.tsx` | Stand-in grid exposing the Sheets DOM contract |
| `src/lib/sheet-engine.ts` | Move and selection rules shared with the playground |
| `scripts/sync-assets.mjs` | Copies sources into `public/` and `extension/` |

## License

MIT
