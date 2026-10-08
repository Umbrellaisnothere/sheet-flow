"use client"

import { useState, type FormEvent } from "react"
import { usePathname, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { AccountState } from "@/lib/settings/store"

type CloudSettings = {
  color: string
  opacity: string
  updatedAt: string
}

const AUTH_MESSAGES: Record<string, string> = {
  ok: "Signed in.",
  error: "Google sign-in failed. You can keep using the highlighter without an account.",
  denied: "Sign-in was cancelled.",
  invalid: "That sign-in link was not valid. Try again.",
  expired: "That sign-in attempt expired. Try again.",
  not_configured:
    "Google sign-in is not configured on this server. The highlighter still works.",
}

export function AccountBar({ initial }: { initial: AccountState }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [signedIn, setSignedIn] = useState(Boolean(initial.email))
  const [email, setEmail] = useState(initial.email)
  const [settings, setSettings] = useState<CloudSettings | null>(
    initial.settings
  )
  const [color, setColor] = useState(initial.settings?.color ?? "#1a73e8")
  const [opacity, setOpacity] = useState(initial.settings?.opacity ?? "0.1")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)

  const authQuery = searchParams.get("auth")
  const authMessage =
    authQuery && AUTH_MESSAGES[authQuery] ? AUTH_MESSAGES[authQuery] : ""

  async function signOut() {
    setBusy(true)
    setNotice("")
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" })
      if (!response.ok) {
        setNotice("Could not sign out. Try again.")
        return
      }
      setSignedIn(false)
      setEmail(null)
      setSettings(null)
    } catch {
      setNotice("Could not sign out. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault()
    if (!signedIn) {
      return
    }
    setBusy(true)
    setNotice("")
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          color,
          opacity,
          baseUpdatedAt: settings?.updatedAt,
        }),
      })
      if (response.status === 400) {
        setNotice(
          "Use a 3- or 6-digit hex colour and opacity between 0.05 and 0.50."
        )
        return
      }
      if (response.status === 409) {
        const body = (await response.json()) as { settings?: CloudSettings }
        if (body.settings) {
          setSettings(body.settings)
          setColor(body.settings.color)
          setOpacity(body.settings.opacity)
        }
        setNotice(
          "Those settings changed elsewhere. Showing the latest saved values."
        )
        return
      }
      if (response.status === 401) {
        setSignedIn(false)
        setEmail(null)
        setNotice("Session expired. Sign in again to save account settings.")
        return
      }
      if (!response.ok) {
        setNotice("Could not save account settings.")
        return
      }
      const body = (await response.json()) as CloudSettings
      setSettings(body)
      setColor(body.color)
      setOpacity(body.opacity)
      setNotice("Saved to your Google account.")
    } catch {
      setNotice("Could not save account settings.")
    } finally {
      setBusy(false)
    }
  }

  const signInHref = `/api/auth/google?next=${encodeURIComponent(pathname || "/")}`

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2 sm:items-end">
      {!initial.configured ? (
        <p className="max-w-xs text-xs text-muted-foreground">
          Account sign-in is not configured on this server.
        </p>
      ) : null}

      {initial.configured && !signedIn ? (
        <a
          href={signInHref}
          className="inline-flex h-8 items-center justify-center rounded-lg border border-[#d0d0d0] bg-white px-2.5 text-sm font-medium text-[#3c4043] hover:bg-[#e8f5ee]"
        >
          Sign in with Google
        </a>
      ) : null}

      {initial.configured && signedIn ? (
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <p className="text-xs text-[#3c4043]">
              Signed in as <span className="font-medium">{email}</span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void signOut()}
              disabled={busy}
            >
              Sign out
            </Button>
          </div>
          <form
            onSubmit={(event) => void saveSettings(event)}
            className="flex flex-wrap items-end justify-end gap-2"
          >
            <div className="grid gap-1">
              <Label htmlFor="account-color" className="text-xs">
                Account colour
              </Label>
              <Input
                id="account-color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                aria-label="Account highlight colour"
                className="w-28"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="account-opacity" className="text-xs">
                Opacity
              </Label>
              <Input
                id="account-opacity"
                value={opacity}
                onChange={(event) => setOpacity(event.target.value)}
                aria-label="Account highlight opacity"
                className="w-20"
                autoComplete="off"
              />
            </div>
            <Button type="submit" size="sm" disabled={busy}>
              Save
            </Button>
          </form>
          <p className="max-w-xs text-right text-[11px] leading-4 text-muted-foreground">
            Website copy only. Sheets still uses the local colour chip until a
            later phase.
          </p>
        </div>
      ) : null}

      {authMessage ? (
        <p
          className="max-w-xs text-right text-xs text-muted-foreground"
          role="status"
        >
          {authMessage}
        </p>
      ) : null}
      {notice ? (
        <p
          className="max-w-xs text-right text-xs text-muted-foreground"
          role="status"
        >
          {notice}
        </p>
      ) : null}
    </div>
  )
}
