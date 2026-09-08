# Focus Cell userscript (Tampermonkey)

This is the install guide for [`sheets-focus-cell.user.js`](sheets-focus-cell.user.js). It draws Excel-style row and column highlight over Google Sheets in your browser. It does not go in Apps Script, and you do not need to edit the script to change the colour.

## 1. Install Tampermonkey

Install Tampermonkey from your browser’s store, then reload the browser.

| Browser | Where to get it |
| --- | --- |
| Microsoft Edge | [Tampermonkey for Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd) |
| Google Chrome | [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) |
| Firefox | [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/) or [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/) |
| Brave / Opera / Vivaldi | Same Chrome listing, or [tampermonkey.net](https://www.tampermonkey.net/) |
| Safari | [Tampermonkey for Safari](https://apps.apple.com/app/tampermonkey/id1482490089), then Safari → Settings → Extensions |

**Chrome 138+ and Edge 138+:** open `chrome://extensions` or `edge://extensions`, click Tampermonkey, turn on **Allow User Scripts**, and restart the browser. Without that toggle the script will install but will not run. Older Chrome/Edge: turn on **Developer mode** instead. Firefox does not need this extra step.

## 2. Add the script

1. Click the Tampermonkey icon → **Dashboard**.
2. Choose **Create a new script** (or the `+` tab).
3. Select the entire template Tampermonkey inserted and delete it.
4. Paste the full contents of [`sheets-focus-cell.user.js`](sheets-focus-cell.user.js).
5. Save (**File → Save**, or `Ctrl+S` / `Cmd+S`).
6. Open or reload a Google Sheet.

The script matches `https://docs.google.com/spreadsheets/*`, including multi-account URLs such as `/u/0/d/…`.

Tampermonkey should show **Focus Cell for Google Sheets** as enabled. If the highlight is missing, confirm the script is on, that **Allow User Scripts** is on (Chrome/Edge), and that you reloaded the spreadsheet after saving.

## 3. Change the highlight colour (no Tampermonkey edit)

You do **not** open the Tampermonkey editor to pick a colour, and you do not refresh the script.

1. Open any Google Sheet with the script enabled.
2. Click the **round colour chip** at the bottom-right of the grid.
3. Pick a preset, or use the colour well for any custom colour.
4. Drag **Opacity** if the band is too faint or too strong.

The choice is stored in this browser (`localStorage` on `docs.google.com`). It survives reloads and new tabs in the same profile. It does not follow you to another computer or another browser profile.

To reset, pick the blue preset (`#1a73e8`) or the Excel-green one (`#217346`).

## 4. Everyday shortcuts

| Action | Windows / Linux | macOS | Firefox |
| --- | --- | --- | --- |
| Show / hide the highlight | `Ctrl+Shift+H` | `Cmd+Shift+H` | `Ctrl+Shift+Period` (History owns `Ctrl+Shift+H`) |
| Close the colour panel | `Escape` | `Escape` | `Escape` |

Whole-row and whole-column picks add no extra band: Sheets already tints those edge to edge.

## 5. Updating the script later

Colour changes do not require an update. You only paste a new `sheets-focus-cell.user.js` when the project ships behaviour changes (new shortcuts, bug fixes). After replacing the file in Tampermonkey, save and reload Sheets. Your saved colour is kept, because it lives in the browser, not in the file.

## 6. If it does not appear

- Tampermonkey icon → the script is listed and enabled.
- Chrome / Edge 138+: **Allow User Scripts** is on, browser was restarted.
- The tab URL starts with `https://docs.google.com/spreadsheets/`.
- You reloaded the spreadsheet after the first save.
- The Android and iOS Sheets **apps** cannot run this. Use Sheets in the mobile browser with Tampermonkey if you need it on a phone.
