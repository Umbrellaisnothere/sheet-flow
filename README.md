# Focus Cell for Google Sheets

Excel highlights the active row and column, then clears that highlight when you move. Google Sheets does not. Painting fills from `onSelectionChange` looks close, then leaves the previous cells highlighted and is slow.

This project does it the way Excel does: the highlight is overlay formatting that follows one stored cell, so leftover color cannot stick. It also includes a batched **Move Visible Records** for filtered data — the function most people write with a `setValue` per row.

## Try it here

```bash
npm install
npm run dev
```

Open the app, click around the pack list, then **Move visible records** from column D into E. Hidden (filtered) rows stay put. Occupied pack bins are skipped. Selection jumps to the destination so the emptied pick cells are no longer selected.

## Install in Google Sheets

The script must be **bound to the spreadsheet you have open** (Extensions → Apps Script from that file). A standalone Apps Script project will not see your worksheet.

1. In the worksheet you are using, open **Extensions → Apps Script**.
2. Replace **the entire** `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs). Do not leave leftover `var FOCUS_SHEET_NAME = ...` at the top — simple triggers like `onSelectionChange` cannot see those globals and throw `ReferenceError: FOCUS_SHEET_NAME is not defined`.
3. Save, reload the spreadsheet, stay on your data tab, then **Excel Tools → Enable Focus Cell on this sheet**. Authorize when prompted.
4. Click cells on that same tab. The current row and column highlight; the previous highlight disappears.
5. Filter a column, select **one** source column, then **Excel Tools → Move Visible Records…**.

`onSelectionChange` only runs in a container-bound script. It will not run from a standalone script project.

## What was wrong

Typical highlighter:

```javascript
sheet.getRange(row, 1, 1, lastCol).setBackground("#fff2cc");
```

That never restores the previous row, so every cell you visit stays “selected.” It also overwrites real fill colors.

Apps Script simple triggers also cannot reliably read top-level `var` / `const` values. A menu or `onSelectionChange` that uses `FOCUS_SHEET_NAME` then throws `ReferenceError`. This script keeps those strings inside functions, which triggers can see.

Typical mover:

```javascript
sheet.getRange(row, destCol).setValue(sourceValue);
sheet.getRange(row, sourceCol).clearContent();
```

Hundreds of spreadsheet writes. Apps Script is fast in memory and slow per `getRange`.

## What this script does instead

**Focus Cell** writes two hidden cells on the active tab. A small overlay (up to 80×12) follows those cells, so your fills are not overwritten. The version that saved/restored hundreds of backgrounds on every click was slower, not faster.

**Move Visible Records** runs on `getActiveSheet()` only. It reads the source and destination once, walks the arrays, then writes each column once (and skips writes if nothing moved). After the move it selects the destination range so the UI does not keep the emptied source selected.

Hidden-by-filter rows are skipped only when a filter exists.

## Files

| Path | Purpose |
| --- | --- |
| `apps-script/Code.gs` | Paste into Google Apps Script |
| `apps-script/appsscript.json` | V8 runtime + spreadsheet scopes |
| `src/lib/sheet-engine.ts` | Same move/selection rules as the script |
| `public/sheets-tools.gs` | Copy source served by the playground |

## License

MIT
