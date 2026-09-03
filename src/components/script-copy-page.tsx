"use client"

import { useState } from "react"
import { Check, Copy, Download } from "lucide-react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/components/ui/button"

export function ScriptCopyPage({ scriptSource }: { scriptSource: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(scriptSource)
      setCopied(true)
      toast.success("Copied. Paste into Extensions → Apps Script → Code.gs")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Copy failed. Select the text below and copy it manually.")
    }
  }

  return (
    <div className="min-h-full bg-[#f3f3f3] p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Code.gs</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste this entire file into the spreadsheet you have open. It only
              highlights the tab you Enable it on, and it never paints over
              existing fill colors.
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
        <pre className="max-h-[75vh] overflow-auto rounded-lg border bg-[#1e1e1e] p-4 text-[12px] leading-5 text-[#d4d4d4] select-text">
          <code>{scriptSource}</code>
        </pre>
      </div>
    </div>
  )
}
