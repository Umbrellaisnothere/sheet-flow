"use client"

import { useState } from "react"
import { Check, Copy, FileCode2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

export function ScriptPanel({ scriptSource }: { scriptSource: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!scriptSource) return
    try {
      await navigator.clipboard.writeText(scriptSource)
      setCopied(true)
      toast.success("Apps Script copied. Paste it into Extensions → Apps Script.")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy. Select the script and copy it manually.")
    }
  }

  return (
    <section
      id="apps-script"
      className="rounded-lg border border-[#d0d0d0] bg-white shadow-sm"
    >
      <div className="flex flex-col gap-3 border-b border-[#d0d0d0] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-base font-medium">
            <FileCode2 className="size-4" />
            Install in Google Sheets
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bound script for the spreadsheet you already use. The playground
            above is the same logic, running here so you can try it without
            Apps Script.
          </p>
        </div>
        <Button type="button" onClick={copy} disabled={!scriptSource}>
          {copied ? (
            <Check data-icon="inline-start" />
          ) : (
            <Copy data-icon="inline-start" />
          )}
          {copied ? "Copied" : "Copy Code.gs"}
        </Button>
      </div>

      <ol className="grid gap-3 px-4 py-4 text-sm sm:grid-cols-3">
        <li className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Step 1
          </p>
          <p className="mt-1">
            Open the spreadsheet you are working in → <strong>Extensions → Apps Script</strong>.
            Delete everything in <code>Code.gs</code>, paste this file in full, and Save.
            Do not keep the old <code>FOCUS_SHEET_NAME</code> lines — simple triggers cannot see them.
          </p>
        </li>
        <li className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Step 2
          </p>
          <p className="mt-1">
            Reload that worksheet. Open{" "}
            <strong>Excel Tools → Enable Focus Cell on this sheet</strong> and
            authorize (that step does the heavy setup once). After that, clicks
            only write three cells, so the highlight should feel instant.
          </p>
        </li>
        <li className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Step 3
          </p>
          <p className="mt-1">
            Filter a column, select one source column, then{" "}
            <strong>Move Visible Records…</strong>. Occupied destinations stay
            put; selection jumps to the destination.
          </p>
        </li>
      </ol>

      <pre className="max-h-[420px] overflow-auto border-t border-[#d0d0d0] bg-[#1e1e1e] p-4 text-[12px] leading-5 text-[#d4d4d4]">
        <code>{scriptSource}</code>
      </pre>
    </section>
  )
}
