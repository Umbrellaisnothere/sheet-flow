"use client"

import { useState } from "react"
import { Check, Copy, Download } from "lucide-react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/components/ui/button"
import { copyText } from "@/lib/copy-text"

export function UserscriptActions({ source }: { source: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const ok = await copyText(source)
    if (!ok) {
      toast.error("Copy failed. Select the script below and copy it manually.")
      return
    }
    setCopied(true)
    toast.success(
      "Copied. Paste it into Tampermonkey or Violentmonkey (Edge, Chrome, Firefox, Safari)."
    )
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" onClick={copy}>
        {copied ? (
          <Check data-icon="inline-start" />
        ) : (
          <Copy data-icon="inline-start" />
        )}
        {copied ? "Copied" : "Copy userscript"}
      </Button>
      <a
        href="/sheets-focus-cell.user.js"
        download="sheets-focus-cell.user.js"
        className={buttonVariants({ variant: "outline" })}
      >
        <Download data-icon="inline-start" />
        Download
      </a>
    </div>
  )
}
