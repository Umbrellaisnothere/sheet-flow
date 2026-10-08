import { Suspense } from "react"

import { AccountBar } from "@/components/account-bar"
import { SiteNav } from "@/components/site-nav"
import { readAccountState } from "@/lib/auth/account-state"

export async function SiteHeader() {
  const initial = await readAccountState()

  return (
    <nav
      aria-label="Focus Cell"
      className="border-b border-[#d0d0d0] bg-white"
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <SiteNav />
        <Suspense
          fallback={
            <p className="text-xs text-muted-foreground">Checking account…</p>
          }
        >
          <AccountBar initial={initial} />
        </Suspense>
      </div>
    </nav>
  )
}
