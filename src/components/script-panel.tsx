"use client"

import { useEffect, useState } from "react"
import { Check, Copy, FileCode2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export function ScriptPanel() {
  const [source, setSource] = useState("")
  const [copied, setCopied] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/sheets-tools.gs")
      .then((response) => {
        if (!response.ok) throw new Error("missing script")
        return response.text()
      })
      .then((text) => {
        if (!cancelled) setSource(text)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const copy = async () => {
    if (!source) return
    try {
      await navigator.clipboard.writeText(source)
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
        <Button onClick={copy} disabled={!source}>
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
            authorize. Click cells on <em>this</em> tab only: the highlight
            follows, the old one clears.
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

      {loadError ? (
        <Alert variant="destructive" className="mx-4 mb-4">
          <AlertTitle>Script file missing</AlertTitle>
          <AlertDescription>
            Could not load <code>sheets-tools.gs</code>. Copy it from{" "}
            <code>apps-script/Code.gs</code> in this repo instead.
          </AlertDescription>
        </Alert>
      ) : (
        <pre className="max-h-[420px] overflow-auto border-t border-[#d0d0d0] bg-[#1e1e1e] p-4 text-[12px] leading-5 text-[#d4d4d4]">
          <code>{source || "Loading script…"}</code>
        </pre>
      )}
    </section>
  )
}
