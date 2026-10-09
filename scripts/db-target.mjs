function isLoopbackHost(host) {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase()
  return (
    !normalized ||
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  )
}

export function describeDatabaseTarget(raw) {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) {
    throw new Error("DATABASE_URL is empty")
  }
  let url
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error("DATABASE_URL is not a valid URL")
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a postgres URL")
  }
  const user = url.username ? `${url.username}:***@` : url.password ? "***@" : ""
  const port = url.port ? `:${url.port}` : ""
  const database = url.pathname && url.pathname !== "/" ? url.pathname : ""
  return {
    label: `${url.protocol}//${user}${url.hostname}${port}${database}`,
    hosted: !isLoopbackHost(url.hostname),
    hostname: url.hostname,
  }
}

export function hostedMigrateRequested(env = process.env, argv = process.argv) {
  return env.MIGRATE_HOSTED === "1" || argv.includes("--hosted")
}
