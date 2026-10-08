export type SettingsRecord = {
  color: string
  opacity: string
  updatedAt: string
}

export type UserRecord = {
  googleSub: string
  email: string
  createdAt: string
  updatedAt: string
}

export type SettingsUpdateResult =
  | { ok: true; settings: SettingsRecord }
  | { ok: false; reason: "conflict"; settings: SettingsRecord }
  | { ok: false; reason: "missing" }

export type AccountState = {
  configured: boolean
  email: string | null
  settings: SettingsRecord | null
}

export type PendingOAuth = {
  state: string
  nonce: string
  codeVerifier: string
  next: string
}

export type AccountStore = {
  upsertUserBySub(sub: string, email: string): Promise<UserRecord>
  getUserBySub(sub: string): Promise<UserRecord | null>
  ensureDefaultSettings(sub: string): Promise<SettingsRecord>
  getSettings(sub: string): Promise<SettingsRecord | null>
  updateSettings(
    sub: string,
    color: string,
    opacity: string,
    baseUpdatedAt?: string
  ): Promise<SettingsUpdateResult>
  saveOAuthPending(pending: PendingOAuth, expiresAt: Date): Promise<void>
  takeOAuthPending(state: string, now?: Date): Promise<PendingOAuth | null>
}
