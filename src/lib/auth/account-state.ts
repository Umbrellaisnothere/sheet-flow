import { cookies } from "next/headers"

import { SESSION_COOKIE, envIsConfigured, readAuthEnv } from "./config.ts"
import { unsealSession } from "./session.ts"
import { getAccountStore } from "../settings/get-store.ts"
import type { AccountState, SettingsRecord } from "../settings/store.ts"

export async function readAccountState(): Promise<AccountState> {
  const jar = await cookies()
  const env = readAuthEnv()
  const store = getAccountStore()
  if (!envIsConfigured(env, Boolean(store))) {
    return { configured: false, email: null, settings: null }
  }
  const session = await unsealSession(
    env.sessionSecret,
    jar.get(SESSION_COOKIE)?.value
  )
  if (!session || !store) {
    return { configured: true, email: null, settings: null }
  }
  let settings: SettingsRecord | null = null
  try {
    settings = await store.getSettings(session.sub)
    if (!settings) {
      await store.upsertUserBySub(session.sub, session.email)
      settings = await store.ensureDefaultSettings(session.sub)
    }
  } catch {
    settings = null
  }
  return {
    configured: true,
    email: session.email || "Google account",
    settings,
  }
}
