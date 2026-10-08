import postgres from "postgres"

import { DEFAULT_COLOR, DEFAULT_OPACITY } from "./validate.ts"
import type {
  AccountStore,
  SettingsRecord,
  SettingsUpdateResult,
  UserRecord,
} from "./store.ts"

function toIso(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString()
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return String(value)
  }
  return parsed.toISOString()
}

function sameInstant(left: string, right: string): boolean {
  const a = Date.parse(left)
  const b = Date.parse(right)
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return a === b
  }
  return left === right
}

function mapUser(row: {
  google_sub: string
  email: string
  created_at: Date | string
  updated_at: Date | string
}): UserRecord {
  return {
    googleSub: row.google_sub,
    email: row.email,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

function mapSettings(row: {
  color: string
  opacity: string
  updated_at: Date | string
}): SettingsRecord {
  return {
    color: row.color,
    opacity: row.opacity,
    updatedAt: toIso(row.updated_at),
  }
}

export function createPostgresStore(databaseUrl: string): AccountStore {
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  return {
    async upsertUserBySub(sub, email) {
      const rows = await sql<
        {
          google_sub: string
          email: string
          created_at: Date
          updated_at: Date
        }[]
      >`
        INSERT INTO users (google_sub, email)
        VALUES (${sub}, ${email})
        ON CONFLICT (google_sub) DO UPDATE
        SET email = EXCLUDED.email,
            updated_at = now()
        RETURNING google_sub, email, created_at, updated_at
      `
      return mapUser(rows[0])
    },
    async getUserBySub(sub) {
      const rows = await sql<
        {
          google_sub: string
          email: string
          created_at: Date
          updated_at: Date
        }[]
      >`
        SELECT google_sub, email, created_at, updated_at
        FROM users
        WHERE google_sub = ${sub}
      `
      return rows[0] ? mapUser(rows[0]) : null
    },
    async ensureDefaultSettings(sub) {
      const inserted = await sql<
        { color: string; opacity: string; updated_at: Date }[]
      >`
        INSERT INTO highlight_settings (google_sub, color, opacity)
        VALUES (${sub}, ${DEFAULT_COLOR}, ${DEFAULT_OPACITY})
        ON CONFLICT (google_sub) DO NOTHING
        RETURNING color, opacity, updated_at
      `
      if (inserted[0]) {
        return mapSettings(inserted[0])
      }
      const existing = await sql<
        { color: string; opacity: string; updated_at: Date }[]
      >`
        SELECT color, opacity, updated_at
        FROM highlight_settings
        WHERE google_sub = ${sub}
      `
      return mapSettings(existing[0])
    },
    async getSettings(sub) {
      const rows = await sql<
        { color: string; opacity: string; updated_at: Date }[]
      >`
        SELECT color, opacity, updated_at
        FROM highlight_settings
        WHERE google_sub = ${sub}
      `
      return rows[0] ? mapSettings(rows[0]) : null
    },
    async updateSettings(sub, color, opacity, baseUpdatedAt) {
      return sql.begin(async (tx) => {
        const current = await tx<
          { color: string; opacity: string; updated_at: Date }[]
        >`
          SELECT color, opacity, updated_at
          FROM highlight_settings
          WHERE google_sub = ${sub}
          FOR UPDATE
        `
        if (!current[0]) {
          const missing: SettingsUpdateResult = { ok: false, reason: "missing" }
          return missing
        }
        const mapped = mapSettings(current[0])
        if (
          typeof baseUpdatedAt === "string" &&
          !sameInstant(mapped.updatedAt, baseUpdatedAt)
        ) {
          const conflict: SettingsUpdateResult = {
            ok: false,
            reason: "conflict",
            settings: mapped,
          }
          return conflict
        }
        const updated = await tx<
          { color: string; opacity: string; updated_at: Date }[]
        >`
          UPDATE highlight_settings
          SET color = ${color},
              opacity = ${opacity},
              updated_at = now()
          WHERE google_sub = ${sub}
          RETURNING color, opacity, updated_at
        `
        const ok: SettingsUpdateResult = {
          ok: true,
          settings: mapSettings(updated[0]),
        }
        return ok
      })
    },
  }
}
