import { databaseUrl } from "../auth/config.ts"
import { createPostgresStore } from "./postgres-store.ts"
import type { AccountStore } from "./store.ts"

let cached: AccountStore | null | undefined

export function getAccountStore(): AccountStore | null {
  if (cached !== undefined) {
    return cached
  }
  const url = databaseUrl()
  cached = url ? createPostgresStore(url) : null
  return cached
}

export function resetAccountStoreCache() {
  cached = undefined
}
