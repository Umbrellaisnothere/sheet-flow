import {
  allowedRequestOrigins,
  resolveRuntimeAppOrigin,
} from "./origin.ts"

function read(name: string): string {
  const value = process.env[name]
  return value ? value.trim() : ""
}

export function appOrigin(): string {
  return resolveRuntimeAppOrigin(process.env)
}

export function googleClientId(): string {
  return read("GOOGLE_CLIENT_ID")
}

export function googleClientSecret(): string {
  return read("GOOGLE_CLIENT_SECRET")
}

export function googleRedirectUri(): string {
  return (
    read("GOOGLE_REDIRECT_URI") ||
    `${appOrigin()}/api/auth/google/callback`
  )
}

export function sessionSecret(): string {
  return read("SESSION_SECRET")
}

export function databaseUrl(): string {
  return read("DATABASE_URL")
}

export function isAuthConfigured(): boolean {
  return Boolean(
    googleClientId() &&
      googleClientSecret() &&
      googleRedirectUri() &&
      sessionSecret() &&
      databaseUrl()
  )
}

export function allowedOrigins(): string[] {
  return allowedRequestOrigins(appOrigin())
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) {
    return false
  }
  return allowedOrigins().includes(origin.replace(/\/$/, ""))
}

export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
export const OAUTH_MAX_AGE_SECONDS = 10 * 60
export const SYNC_REQUEST_MAX_AGE_SECONDS = 10 * 60
export const SYNC_TOKEN_MAX_AGE_SECONDS = SESSION_MAX_AGE_SECONDS
export const SESSION_COOKIE = "fc_session"
export const OAUTH_COOKIE = "fc_oauth"

export function cookieSecure(origin = appOrigin()): boolean {
  return origin.startsWith("https://")
}

export type AuthEnv = {
  googleClientId: string
  googleClientSecret: string
  googleRedirectUri: string
  sessionSecret: string
  appOrigin: string
}

export function readAuthEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return {
    googleClientId: overrides.googleClientId ?? googleClientId(),
    googleClientSecret: overrides.googleClientSecret ?? googleClientSecret(),
    googleRedirectUri: overrides.googleRedirectUri ?? googleRedirectUri(),
    sessionSecret: overrides.sessionSecret ?? sessionSecret(),
    appOrigin: (overrides.appOrigin ?? appOrigin()).replace(/\/$/, ""),
  }
}

export function envIsConfigured(env: AuthEnv, hasStore: boolean): boolean {
  return Boolean(
    env.googleClientId &&
      env.googleClientSecret &&
      env.googleRedirectUri &&
      env.sessionSecret.length >= 32 &&
      env.appOrigin &&
      hasStore
  )
}
