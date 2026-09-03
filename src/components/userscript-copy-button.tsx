"use client"

import { useState } from "react"
import { Check, Copy, Download } from "lucide-react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/components/ui/button"

export function UserscriptActions({ source }: { source: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source)
      setCopied(true)
      toast.success("Copied. Paste it into a new Tampermonkey script.")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Copy failed. Select the script below and copy it manually.")
    }
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
