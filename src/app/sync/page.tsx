import Link from "next/link"

import { SyncApprove } from "@/components/sync-approve"
import { readAccountState } from "@/lib/auth/account-state"

export default async function SyncPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>
}) {
  const params = await searchParams
  const requestId = typeof params.request === "string" ? params.request.trim() : ""
  const account = await readAccountState()
  const next = requestId
    ? `/sync?request=${encodeURIComponent(requestId)}`
    : "/sync"
  const signInHref = `/api/auth/google?next=${encodeURIComponent(next)}`

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight text-[#202124]">
        Highlighter cloud sync
      </h1>
      <p className="text-sm leading-6 text-[#3c4043]">
        This lets the Tampermonkey highlighter read and update the same colour and
        opacity as your Focus Cell account. It does not see your spreadsheet.
        You can turn it off in the colour chip at any time.
      </p>
      {!requestId ? (
        <p className="text-sm text-muted-foreground">
          Open this page from the highlighter&apos;s <strong>Enable cloud sync</strong>{" "}
          control. Direct visits cannot approve a request.
        </p>
      ) : !account.configured ? (
        <p className="text-sm text-muted-foreground">
          Google sign-in is not configured on this server. The highlighter still
          works with local colour.
        </p>
      ) : !account.email ? (
        <div className="grid gap-3">
          <p className="text-sm text-[#3c4043]">
            Sign in with Google on this site first, then approve the highlighter.
          </p>
          <a
            href={signInHref}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground"
          >
            Sign in with Google
          </a>
        </div>
      ) : (
        <div className="grid gap-3 rounded-xl border border-[#d0d0d0] bg-white p-4">
          <p className="text-sm text-[#3c4043]">
            Signed in as <span className="font-medium">{account.email}</span>
          </p>
          <SyncApprove requestId={requestId} />
        </div>
      )}
      <p>
        <Link href="/" className="text-sm text-[#137333] underline-offset-2 hover:underline">
          Back to Focus Cell
        </Link>
      </p>
    </main>
  )
}
