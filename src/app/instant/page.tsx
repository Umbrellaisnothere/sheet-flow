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
            highlight you see here is the highlight you get in Sheets.
          </p>
        </header>

        <div className="rounded-lg border border-[#d0d0d0] bg-white p-4 shadow-sm">
          <SheetsDomMock />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-lg border border-[#d0d0d0] bg-white p-4 shadow-sm">
            <h2 className="font-heading text-base font-medium">
              Install with Tampermonkey
            </h2>
            <ol className="mt-2 space-y-2 text-sm text-muted-foreground">
              <li>
                1. Install{" "}
                <a
                  className="text-[#217346] underline"
                  href="https://www.tampermonkey.net/"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  Tampermonkey
                </a>{" "}
                in Chrome, Edge, or Firefox.
              </li>
              <li>2. Open its dashboard and create a new script.</li>
              <li>
                3. Replace the template with the file below, save, and reload
                your spreadsheet.
              </li>
            </ol>
            <div className="mt-3">
              <UserscriptActions source={source} />
            </div>
          </section>

          <section className="rounded-lg border border-[#d0d0d0] bg-white p-4 shadow-sm">
            <h2 className="font-heading text-base font-medium">
              Or load it as an extension
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              If you would rather not install Tampermonkey, the repository has
              an <code>extension/</code> folder holding the same file plus a
              manifest. Open <code>chrome://extensions</code>, turn on Developer
              mode, and choose Load unpacked.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Either way it only reads the page. It never edits your
              spreadsheet, so it cannot overwrite a fill colour, and it works on
              every tab at once with nothing to enable per sheet.
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
