import Link from "next/link"
import Script from "next/script"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Copy, Zap } from "lucide-react"

import { SheetsDomMock } from "@/components/sheets-dom-mock"
import { UserscriptActions } from "@/components/userscript-copy-button"

export const metadata = {
  title: "Instant crosshair · Focus Cell for Google Sheets",
  description:
    "The browser-side highlighter, running against the same DOM contract Google Sheets exposes.",
}

export default function InstantPage() {
  const source = readFileSync(
    join(process.cwd(), "userscript", "sheets-focus-cell.user.js"),
    "utf8"
  )

  return (
    <div className="min-h-full bg-[#f3f3f3] p-4 sm:p-6">
      <Script src="/sheets-focus-cell.user.js" strategy="afterInteractive" />

      <div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-[#217346] uppercase">
            <Zap className="size-4" />
            No server round trip
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            The crosshair, drawn in the browser
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            The grid below is not Google Sheets, but it publishes the same three
            things the real one does: a <code>#waffle-grid-container</code>, four{" "}
            <code>.active-cell-border</code> elements around the current cell,
            and <code>.selection</code> rectangles for wider picks. The exact
            file you install is running on this page against them, so the
            highlight you see here is the highlight you get in Sheets. Click
            the colour chip in the corner — a first-run tip explains it, and
            Hide highlight is in that panel.
          </p>
        </header>

        <div className="rounded-lg border border-[#d0d0d0] bg-white p-4 shadow-sm">
          <SheetsDomMock />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-lg border border-[#d0d0d0] bg-white p-4 shadow-sm">
            <h2 className="font-heading text-base font-medium">
              Tampermonkey or Violentmonkey
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Works in Edge, Chrome, Firefox, Brave, Opera, and Safari. Install
              the manager from your browser&apos;s store, paste the file below
              as a new script, and reload Sheets.
            </p>
            <ol className="mt-2 space-y-2 text-sm text-muted-foreground">
              <li>
                1.{" "}
                <a
                  className="text-[#217346] underline"
                  href="https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  Tampermonkey for Edge
                </a>
                ,{" "}
                <a
                  className="text-[#217346] underline"
                  href="https://www.tampermonkey.net/"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  other browsers
                </a>
                , or{" "}
                <a
                  className="text-[#217346] underline"
                  href="https://violentmonkey.github.io/get-it/"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  Violentmonkey
                </a>
                .
              </li>
              <li>
                2. Edge and Chrome 138+: open the extension details and turn on{" "}
                <strong>Allow User Scripts</strong>, then restart the browser.
                Firefox skips this. Toggle with Ctrl+Shift+H (Cmd+Shift+H on a
                Mac). Firefox uses Ctrl+Shift+Period because Ctrl+Shift+H opens
                History.
              </li>
              <li>
                3. Dashboard → new script → replace the template → save → reload
                the spreadsheet. After that, type a hex colour or drag opacity
                on the chip — a refresh keeps both. The full walkthrough is{" "}
                <code>userscript/README.md</code>.
              </li>
            </ol>
            <div className="mt-3">
              <UserscriptActions source={source} />
            </div>
          </section>

          <section className="rounded-lg border border-[#d0d0d0] bg-white p-4 shadow-sm">
            <h2 className="font-heading text-base font-medium">
              Unpacked in Edge or Chrome
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Skip the script manager. The <code>extension/</code> folder is a
              Manifest V3 add-on that Edge loads the same way Chrome does.
            </p>
            <ol className="mt-2 space-y-2 text-sm text-muted-foreground">
              <li>
                1. Open <code>edge://extensions</code> or{" "}
                <code>chrome://extensions</code>.
              </li>
              <li>2. Turn on Developer mode.</li>
              <li>
                3. Load unpacked and select the <code>extension</code> folder.
              </li>
            </ol>
            <p className="mt-2 text-sm text-muted-foreground">
              Firefox: <code>about:debugging#/runtime/this-firefox</code> → Load
              Temporary Add-on → <code>extension/manifest.json</code>.
            </p>
          </section>

          <section className="rounded-lg border border-[#d0d0d0] bg-white p-4 shadow-sm">
            <h2 className="font-heading text-base font-medium">
              What this cannot cover
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The Android and iOS Sheets <em>apps</em> are not web pages, so
              nothing can draw over their grid. Internet Explorer and old Edge
              (EdgeHTML) cannot run Google Sheets at all.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Safari cannot load the unpacked Chromium folder. Use Tampermonkey
              from the App Store instead, then enable it under Safari →
              Settings → Extensions.
            </p>
            <Link
              href="/script"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[#217346] underline"
            >
              <Copy className="size-4" />
              Apps Script for Move Visible Records
            </Link>
          </section>
        </div>

        <section className="rounded-lg border border-[#d0d0d0] bg-white shadow-sm">
          <h2 className="border-b border-[#d0d0d0] px-4 py-3 font-heading text-base font-medium">
            sheets-focus-cell.user.js
          </h2>
          <pre className="max-h-[420px] overflow-auto p-4 text-[12px] leading-5 select-text">
            <code>{source}</code>
          </pre>
        </section>
      </div>
    </div>
  )
}
