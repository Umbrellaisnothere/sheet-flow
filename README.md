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

1. Open the spreadsheet → **Extensions → Apps Script**.
2. Replace the default `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs) (or copy it from the playground).
3. Save, reload the sheet, then **Excel Tools → Enable Focus Cell**. Authorize when prompted.
4. Click cells. The current row and column highlight; the previous highlight disappears.
5. Filter a column, select **one** source column, then **Excel Tools → Move Visible Records…**.

`onSelectionChange` only runs in a **container-bound** script (Extensions → Apps Script on that spreadsheet). It will not run from a standalone script project.

## What was wrong

Typical highlighter:

```javascript
sheet.getRange(row, 1, 1, lastCol).setBackground("#fff2cc");
```

That never restores the previous row, so every cell you visit stays “selected.” It also overwrites real fill colors.

Typical mover:

```javascript
sheet.getRange(row, destCol).setValue(sourceValue);
sheet.getRange(row, sourceCol).clearContent();
```

Hundreds of spreadsheet writes. Apps Script is fast in memory and slow per `getRange`.

## What this script does instead

**Focus Cell** writes the active row, column, and sheet name to a hidden `_FocusCell` sheet (three cells). Conditional formatting on the data sheet follows that cell. Previous highlights vanish because they were never painted onto the cells. Your existing colors stay intact.

**Move Visible Records** reads the source and destination once, walks the arrays, then writes each column once. After the move it selects the destination range so the UI does not keep the emptied source selected.

Hidden rows are skipped only when a filter exists (`getFilter()`), so unfiltered sheets do not pay for `isRowHiddenByFilter` on every row.

## Files

| Path | Purpose |
| --- | --- |
| `apps-script/Code.gs` | Paste into Google Apps Script |
| `apps-script/appsscript.json` | V8 runtime + spreadsheet scopes |
| `src/lib/sheet-engine.ts` | Same move/selection rules as the script |
| `public/sheets-tools.gs` | Copy source served by the playground |

## License

MIT
