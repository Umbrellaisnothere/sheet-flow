import postgres from "postgres"

import { DEFAULT_COLOR, DEFAULT_OPACITY } from "./validate.ts"
import type {
  AccountStore,
  PendingOAuth,
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
    async saveOAuthPending(pending, expiresAt) {
      await sql`
        DELETE FROM oauth_pending WHERE expires_at <= now()
      `
      await sql`
        INSERT INTO oauth_pending (state, nonce, code_verifier, next_path, expires_at)
        VALUES (
          ${pending.state},
          ${pending.nonce},
          ${pending.codeVerifier},
          ${pending.next},
          ${expiresAt}
        )
        ON CONFLICT (state) DO UPDATE
        SET nonce = EXCLUDED.nonce,
            code_verifier = EXCLUDED.code_verifier,
            next_path = EXCLUDED.next_path,
            expires_at = EXCLUDED.expires_at
      `
    },
    async takeOAuthPending(state, now = new Date()) {
      const rows = await sql<
        {
          state: string
          nonce: string
          code_verifier: string
          next_path: string
        }[]
      >`
        DELETE FROM oauth_pending
        WHERE state = ${state}
          AND expires_at > ${now}
        RETURNING state, nonce, code_verifier, next_path
      `
      const row = rows[0]
      if (!row) {
        return null
      }
      const pending: PendingOAuth = {
        state: row.state,
        nonce: row.nonce,
        codeVerifier: row.code_verifier,
        next: row.next_path,
      }
      return pending
    },
    async createSyncRequest(input) {
      await sql`DELETE FROM sync_requests WHERE expires_at <= now()`
      await sql`
        INSERT INTO sync_requests (request_id, poll_secret_hash, expires_at)
        VALUES (${input.requestId}, ${input.pollSecretHash}, ${input.expiresAt})
        ON CONFLICT (request_id) DO UPDATE
        SET poll_secret_hash = EXCLUDED.poll_secret_hash,
            google_sub = NULL,
            email = '',
            issued_token = NULL,
            token_hash = NULL,
            token_expires_at = NULL,
            expires_at = EXCLUDED.expires_at
      `
    },
    async approveSyncRequest(input) {
      const now = input.now ?? new Date()
      return sql.begin(async (tx) => {
        const rows = await tx<
          { request_id: string }[]
        >`
          SELECT request_id FROM sync_requests
          WHERE request_id = ${input.requestId}
            AND expires_at > ${now}
          FOR UPDATE
        `
        if (!rows[0]) {
          return false
        }
        await tx`
          INSERT INTO sync_tokens (token_hash, google_sub, email, expires_at)
          VALUES (
            ${input.tokenHash},
            ${input.googleSub},
            ${input.email},
            ${input.tokenExpiresAt}
          )
          ON CONFLICT (token_hash) DO UPDATE
          SET google_sub = EXCLUDED.google_sub,
              email = EXCLUDED.email,
              expires_at = EXCLUDED.expires_at
        `
        await tx`
          UPDATE sync_requests
          SET google_sub = ${input.googleSub},
              email = ${input.email},
              issued_token = ${input.issuedToken},
              token_hash = ${input.tokenHash},
              token_expires_at = ${input.tokenExpiresAt}
          WHERE request_id = ${input.requestId}
        `
        return true
      })
    },
    async pollSyncRequest(input) {
      const now = input.now ?? new Date()
      return sql.begin(async (tx) => {
        const rows = await tx<
          {
            issued_token: string | null
            email: string
            token_expires_at: Date | null
          }[]
        >`
          SELECT issued_token, email, token_expires_at
          FROM sync_requests
          WHERE request_id = ${input.requestId}
            AND poll_secret_hash = ${input.pollSecretHash}
            AND expires_at > ${now}
          FOR UPDATE
        `
        const row = rows[0]
        if (!row) {
          return { status: "missing" as const }
        }
        if (!row.issued_token || !row.token_expires_at) {
          return { status: "pending" as const }
        }
        const token = row.issued_token
        const email = row.email
        const expiresAt = toIso(row.token_expires_at)
        await tx`
          UPDATE sync_requests
          SET issued_token = NULL
          WHERE request_id = ${input.requestId}
        `
        return { status: "ready" as const, token, email, expiresAt }
      })
    },
    async getSyncToken(tokenHash, now = new Date()) {
      const rows = await sql<
        { google_sub: string; email: string }[]
      >`
        SELECT google_sub, email
        FROM sync_tokens
        WHERE token_hash = ${tokenHash}
          AND expires_at > ${now}
      `
      const row = rows[0]
      if (!row) {
        return null
      }
      return { googleSub: row.google_sub, email: row.email }
    },
    async deleteSyncTokensForSub(googleSub) {
      await sql`DELETE FROM sync_tokens WHERE google_sub = ${googleSub}`
      await sql`DELETE FROM sync_requests WHERE google_sub = ${googleSub}`
    },
  }
}
