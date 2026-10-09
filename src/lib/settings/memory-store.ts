import { DEFAULT_COLOR, DEFAULT_OPACITY, isoNow } from "./validate.ts"
import type {
  AccountStore,
  PendingOAuth,
  SettingsRecord,
  UserRecord,
} from "./store.ts"

function sameInstant(left: string, right: string): boolean {
  const a = Date.parse(left)
  const b = Date.parse(right)
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return a === b
  }
  return left === right
}

export function createMemoryStore(now: () => Date = () => new Date()): AccountStore {
  const users = new Map<string, UserRecord>()
  const settings = new Map<string, SettingsRecord>()
  const pendingOAuth = new Map<string, PendingOAuth & { expiresAt: number }>()
  type MemorySyncRequest = {
    pollSecretHash: string
    googleSub: string | null
    email: string
    issuedToken: string | null
    tokenExpiresAt: number
    expiresAt: number
  }
  const syncRequests = new Map<string, MemorySyncRequest>()
  const syncTokens = new Map<string, { googleSub: string; email: string; expiresAt: number }>()

  return {
    async upsertUserBySub(sub, email) {
      const existing = users.get(sub)
      const stamp = isoNow(now())
      if (!existing) {
        const created: UserRecord = {
          googleSub: sub,
          email,
          createdAt: stamp,
          updatedAt: stamp,
        }
        users.set(sub, created)
        return created
      }
      const updated: UserRecord = {
        ...existing,
        email,
        updatedAt: stamp,
      }
      users.set(sub, updated)
      return updated
    },
    async getUserBySub(sub) {
      return users.get(sub) ?? null
    },
    async ensureDefaultSettings(sub) {
      const existing = settings.get(sub)
      if (existing) {
        return existing
      }
      const created: SettingsRecord = {
        color: DEFAULT_COLOR,
        opacity: DEFAULT_OPACITY,
        updatedAt: isoNow(now()),
      }
      settings.set(sub, created)
      return created
    },
    async getSettings(sub) {
      return settings.get(sub) ?? null
    },
    async updateSettings(sub, color, opacity, baseUpdatedAt) {
      const current = settings.get(sub)
      if (!current) {
        return { ok: false, reason: "missing" }
      }
      if (
        typeof baseUpdatedAt === "string" &&
        !sameInstant(current.updatedAt, baseUpdatedAt)
      ) {
        return { ok: false, reason: "conflict", settings: current }
      }
      const next: SettingsRecord = {
        color,
        opacity,
        updatedAt: isoNow(now()),
      }
      settings.set(sub, next)
      return { ok: true, settings: next }
    },
    async saveOAuthPending(pending, expiresAt) {
      pendingOAuth.set(pending.state, {
        ...pending,
        expiresAt: expiresAt.getTime(),
      })
    },
    async takeOAuthPending(state, now = new Date()) {
      const row = pendingOAuth.get(state)
      pendingOAuth.delete(state)
      if (!row || row.expiresAt <= now.getTime()) {
        return null
      }
      return {
        state: row.state,
        nonce: row.nonce,
        codeVerifier: row.codeVerifier,
        next: row.next,
      }
    },
    async createSyncRequest(input) {
      syncRequests.set(input.requestId, {
        pollSecretHash: input.pollSecretHash,
        googleSub: null,
        email: "",
        issuedToken: null,
        tokenExpiresAt: 0,
        expiresAt: input.expiresAt.getTime(),
      })
    },
    async approveSyncRequest(input) {
      const now = (input.now ?? new Date()).getTime()
      const row = syncRequests.get(input.requestId)
      if (!row || row.expiresAt <= now) {
        return false
      }
      row.googleSub = input.googleSub
      row.email = input.email
      row.issuedToken = input.issuedToken
      row.tokenExpiresAt = input.tokenExpiresAt.getTime()
      syncTokens.set(input.tokenHash, {
        googleSub: input.googleSub,
        email: input.email,
        expiresAt: input.tokenExpiresAt.getTime(),
      })
      return true
    },
    async pollSyncRequest(input) {
      const now = (input.now ?? new Date()).getTime()
      const row = syncRequests.get(input.requestId)
      if (!row || row.expiresAt <= now) {
        return { status: "missing" }
      }
      if (row.pollSecretHash !== input.pollSecretHash) {
        return { status: "missing" }
      }
      if (!row.issuedToken) {
        return { status: "pending" }
      }
      const token = row.issuedToken
      const email = row.email
      const expiresAt = new Date(row.tokenExpiresAt).toISOString()
      row.issuedToken = null
      return { status: "ready", token, email, expiresAt }
    },
    async getSyncToken(tokenHash, now = new Date()) {
      const row = syncTokens.get(tokenHash)
      if (!row || row.expiresAt <= now.getTime()) {
        return null
      }
      return { googleSub: row.googleSub, email: row.email }
    },
    async deleteSyncTokensForSub(googleSub) {
      for (const [hash, row] of syncTokens) {
        if (row.googleSub === googleSub) {
          syncTokens.delete(hash)
        }
      }
      for (const [id, row] of syncRequests) {
        if (row.googleSub === googleSub) {
          syncRequests.delete(id)
        }
      }
    },
  }
}
