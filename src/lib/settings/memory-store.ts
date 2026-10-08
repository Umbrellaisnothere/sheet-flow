import { DEFAULT_COLOR, DEFAULT_OPACITY, isoNow } from "./validate.ts"
import type { AccountStore, SettingsRecord, UserRecord } from "./store.ts"

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
  }
}
