export function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra)
  headers.set("content-type", "application/json; charset=utf-8")
  headers.set("cache-control", "no-store")
  return new Response(JSON.stringify(body), { status, headers })
}

export function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>
): Response {
  return json({ error, ...extra }, status)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function htmlMessage(
  title: string,
  body: string,
  status = 200,
  extraHeaders?: Headers
): Response {
  const headers = extraHeaders ?? new Headers()
  headers.set("content-type", "text/html; charset=utf-8")
  headers.set("cache-control", "no-store")
  const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <p>${escapeHtml(body)}</p>
    <p><a href="/">Back to Focus Cell</a></p>
  </body>
</html>`
  return new Response(page, { status, headers })
}

export function redirectTo(
  location: string,
  extraHeaders?: Headers
): Response {
  const headers = extraHeaders ?? new Headers()
  headers.set("location", location)
  headers.set("cache-control", "no-store")
  return new Response(null, { status: 302, headers })
}
