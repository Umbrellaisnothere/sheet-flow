"use client"

import { useState } from "react"
import { Check, Copy, Download } from "lucide-react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/components/ui/button"
import { copyText } from "@/lib/copy-text"

export function ScriptCopyPage({ scriptSource }: { scriptSource: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const ok = await copyText(scriptSource)
    if (!ok) {
      toast.error("Copy failed. Select the text below and copy it manually.")
      return
    }
    setCopied(true)
    toast.success("Copied. Paste into Extensions → Apps Script → Code.gs")
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-full bg-[#f3f3f3] p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Install Move Visible Records</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste this entire file into the spreadsheet you have open. After
              you reload, the menu is named <strong>Focus Cell</strong>. Use
              that for moving filtered rows. Leave{" "}
              <strong>Enable highlight (slow)</strong> off if you already
              installed the userscript.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={copy}>
              {copied ? (
                <Check data-icon="inline-start" />
              ) : (
                <Copy data-icon="inline-start" />
              )}
              {copied ? "Copied" : "Copy all"}
            </Button>
            <a
              href="/sheets-tools.gs"
              download="Code.gs"
              className={buttonVariants({ variant: "outline" })}
            >
              <Download data-icon="inline-start" />
              Download Code.gs
            </a>
          </div>
        </div>
        <ol className="grid gap-3 text-sm sm:grid-cols-3">
          <li className="rounded-lg border bg-white p-3 shadow-sm">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Step 1
            </p>
            <p className="mt-1">
              In the spreadsheet you are using:{" "}
              <strong>Extensions → Apps Script</strong>. Replace everything in{" "}
              <code>Code.gs</code>, then Save.
            </p>
          </li>
          <li className="rounded-lg border bg-white p-3 shadow-sm">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Step 2
            </p>
            <p className="mt-1">
              Reload the tab. Open the <strong>Focus Cell</strong> menu. If an
              old highlight is stuck, choose{" "}
              <strong>Disable highlight on this sheet</strong> once.
            </p>
          </li>
          <li className="rounded-lg border bg-white p-3 shadow-sm">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Step 3
            </p>
            <p className="mt-1">
              Filter, select one source column, then{" "}
              <strong>Move Visible Records…</strong>. Leave the box blank to
              reuse the last destination.
            </p>
          </li>
        </ol>
        <pre className="max-h-[75vh] overflow-auto rounded-lg border bg-[#1e1e1e] p-4 text-[12px] leading-5 text-[#d4d4d4] select-text">
          <code>{scriptSource}</code>
        </pre>
      </div>
    </div>
  )
}
