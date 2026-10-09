"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

export function SyncApprove({ requestId }: { requestId: string }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")

  async function approve() {
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/sync/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId }),
      })
      if (response.status === 401) {
        setError("Sign in with Google first, then approve again.")
        return
      }
      if (response.status === 404) {
        setError("That sync request expired. Enable sync from the highlighter again.")
        return
      }
      if (!response.ok) {
        setError("Could not approve sync. Try again.")
        return
      }
      setDone(true)
    } catch {
      setError("Could not reach this server. Try again.")
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p className="text-sm text-[#137333]">
        Approved. Return to Google Sheets — the highlighter will finish connecting.
        You can close this tab.
      </p>
    )
  }

  return (
    <div className="grid gap-3">
      <Button type="button" onClick={() => void approve()} disabled={busy}>
        Allow colour sync
      </Button>
      {error ? (
        <p className="text-sm text-muted-foreground" role="status">
          {error}
        </p>
      ) : null}
    </div>
  )
}
