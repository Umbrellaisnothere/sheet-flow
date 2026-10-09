# Optional Google-account settings (architecture)

Status: **Phase 4 — optional Tampermonkey cloud sync.** Website Google OAuth, `fc_session`, and settings APIs are in place. The highlighter stays local-first. Cloud sync uses a short-lived revocable bearer grant issued on the Focus Cell origin, not the HttpOnly session cookie. `@connect` is `127.0.0.1` for local development only. **No production hostname is confirmed in this repo**; do not bake a placeholder host into the userscript.

Phase 1 remains the design record. This section records what Phase 2 actually shipped.

### Phase 2 implementation notes

- **Database:** two tables, `users` and `highlight_settings`, keyed by Google OIDC `sub` (`google_sub`). Email is display-only and not unique. Schema: [`docs/schema.sql`](schema.sql). Apply with `npm run db:migrate` (requires `DATABASE_URL`). Non-destructive; `CREATE TABLE IF NOT EXISTS` only.
- **Store:** `postgres` (postgres.js) when `DATABASE_URL` is set. Unit tests use an in-memory store. `src/lib/settings/postgres.live.test.ts` hits a real database when `.env.local` has `DATABASE_URL`. Missing Google credentials still return **503** `not_configured` on the website; the highlighter does not need them.
- **Migrate:** `npm run db:migrate` loads `.env.local` / `.env`. Schema is `CREATE TABLE IF NOT EXISTS` only.
- **OAuth:** authorization code + PKCE S256, scopes `openid email profile` only. ID token verified with Google JWKS (`iss`, `aud`, `exp`, `nonce`). Google access tokens are discarded. Client secret stays server-side.
- **Session:** encrypted JWE cookie `fc_session` (`dir` + `A256GCM` via `jose`), HttpOnly, SameSite=Lax, Secure in production / HTTPS, 7-day lifetime. Payload: `{ sub, email, exp }`. Short-lived `fc_oauth` cookie holds `state`, `nonce`, and `code_verifier`.
- **Optimistic concurrency:** `PUT /api/settings` accepts optional `baseUpdatedAt`. Mismatch → **409** with the current row. The server always stamps `updatedAt` in UTC ISO-8601.
- **Website UI:** optional “Sign in with Google” in the header. No login wall. Cloud colour/opacity on the site are independent of the userscript chip.
- **Tampermonkey sync:** `GM_xmlhttpRequest` with `anonymous: true` and `Authorization: Bearer`. SameSite=Lax `fc_session` is not sent from Sheets; do not rely on cookie transport. Grant is hashed in `sync_tokens` and deleted on website logout.
- **Not implemented:** extension `chrome.identity`, production `@connect` host (blocked until an HTTPS origin is confirmed), rate limiting. Production `APP_ORIGIN` is required and is not defaulted to localhost. HTTP is rejected except for loopback development.

### Environment variables

Copy [`.env.example`](../.env.example) to `.env.local`. **Server-only** (never `NEXT_PUBLIC_`):

| Name | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Web OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Web OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Exact callback, e.g. `http://127.0.0.1:43173/api/auth/google/callback` |
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | ≥32 characters for cookie encryption |
| `APP_ORIGIN` | Canonical origin, no path. Local: `http://127.0.0.1:43173`. Production: required HTTPS origin; missing values are not defaulted to localhost |

Nothing in this list is safe to expose to the browser or the userscript.

---

---

## 1. Verified existing architecture

Inspected on disk (not assumed from earlier chat). Findings:

### Website

| Item | Found |
| --- | --- |
| Framework | Next.js **16.3.4** App Router (`src/app/`), React **19.2.8**, TypeScript, Tailwind 4, shadcn/ui |
| Package manager | **npm** (`package-lock.json`). Node `>=22.6.0` |
| Routes | `/` playground, `/instant` userscript demo, `/script` Code.gs copy. No `src/app/api/`. No `middleware.ts` / `proxy.ts` |
| Dev server | `next dev --port 43173 --hostname 0.0.0.0` (also `next start` on 43173) |
| Deployment | No `vercel.json`, no Dockerfile, no deploy docs. `.gitignore` includes `.vercel`. The app is a static-capable Next site (CI runs `npm run build`). Vercel is a fit; nothing is wired yet |
| Env convention | `.gitignore` has `.env*` (all env files ignored). **No** `.env`, `.env.example`, or `process.env` usage in app code |
| Auth | **None** (no NextAuth/Auth.js, no sessions, no Google Identity) |
| Database | **None** (no Prisma, Drizzle, SQLite, Postgres client) |
| API / server | **None** beyond Next rendering `page.tsx` files. Pages read local files with `readFileSync` (Code.gs / userscript source) |

### Tests

| Item | Found |
| --- | --- |
| Runner | Node built-in test runner: `node --experimental-strip-types --test …` |
| Files | `userscript/overlay.test.mjs`, `userscript/compat-security.test.mjs`, `apps-script/code.test.mjs`, `apps-script/no-globals.test.mjs`, `src/lib/sheet-engine.test.ts` |
| CI | `.github/workflows/ci.yml`: `npm ci`, lint, test, build, `npm run sync && git diff --exit-code` |

### Tampermonkey / userscript (source of truth)

`userscript/sheets-focus-cell.user.js` **v1.5.0**, copied by `scripts/sync-assets.mjs` to `public/sheets-focus-cell.user.js` and `extension/content.js`.

Header grants (storage only):

```
@grant GM_getValue
@grant GM_setValue
@grant GM.getValue
@grant GM.setValue
```

No `@connect`. No `GM_xmlhttpRequest`. `@match` / `@include` are `https://docs.google.com/spreadsheets/*` only.

Settings JSON in GM storage then `localStorage` key `sheets-focus-cell`:

```json
{ "color": "#1a73e8", "opacity": "0.1", "seenTip": true }
```

Colour: `#rgb` or `#rrggbb` (optional `#`), lowercased. Opacity: number clamped **0.05–0.50**, stored as a string with two decimal places (e.g. `"0.1"`). `seenTip` is first-run UX, device-local.

Paint: overlay `#sheets-focus-cell-overlay`, `pointer-events: none`, duplicate-install guard if overlay already exists. Panel `#sheets-focus-cell-panel` is the settings UI (presets, colour well, hex, opacity bar, Hide highlight).

`/instant` loads that **same file** via `next/script` (`src="/sheets-focus-cell.user.js"`) against `SheetsDomMock` (`#waffle-grid-container`, `.active-cell-border`, `.selection`).

### Extension (architecture only for later)

`extension/manifest.json` MV3, `host_permissions` and content_scripts match Sheets HTTPS only. No `identity` permission, no background worker, no `chrome.storage`. Content script is the synced userscript. **Do not implement extension auth in Phase 2.**

### Apps Script (out of scope for colour sync)

`apps-script/Code.gs` + `appsscript.json` scopes:

- `https://www.googleapis.com/auth/spreadsheets.currentonly`
- `https://www.googleapis.com/auth/script.container.ui`

`PropertiesService` holds per-spreadsheet highlight-on flags and last move destination. That is **not** the highlighter colour and must not become the cloud settings store.

### Security tests that Phase 2 must not break until deliberately updated

`userscript/compat-security.test.mjs` currently requires:

| Check | Current rule |
| --- | --- |
| `@grant` | Only the four GM storage names |
| `GM_xmlhttpRequest`, `GM_cookie`, `unsafeWindow` | Forbidden in header |
| `@connect`, `@require`, `@resource` | Forbidden |
| `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` | Forbidden in source |
| `eval` / `new Function` | Forbidden |
| `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `document.write` | Forbidden |
| Colour XSS strings | Must not become `backgroundColor` |
| Overlay | `pointer-events: none` |
| Storage | Private-mode throw still paints; corrupt GM ignored |

`userscript/overlay.test.mjs` pins geometry, toggle shortcuts, chip above overlay, local persist.

**Phase 1 does not change these tests.**

### Privacy policy

There is **no** privacy policy in the repo. MIT `LICENSE` only.

---

## 2. Proposed architecture (smallest)

Keep the existing static site. Add **Next.js Route Handlers in this same app** so one Vercel deployment serves UI + API. No second service, no Docker, no Auth.js adapter graph unless Phase 2 hits OAuth edge cases worth the dependency.

```
                    ┌─────────────────────────────────────────┐
                    │  Next.js 16 (this repo) on HTTPS origin │
                    │  e.g. https://<app-host>                │
                    │                                         │
  Browser tab ─────►│  /  /instant  /script   (unchanged UI)  │
  (first-party)     │                                         │
                    │  GET  /api/auth/google                  │
                    │  GET  /api/auth/google/callback         │
                    │  POST /api/auth/logout                  │
                    │  GET  /api/auth/session                 │
                    │  GET  /api/settings                     │
                    │  PUT  /api/settings                     │
                    │           │                             │
                    │           ▼                             │
                    │  Encrypted HttpOnly session cookie      │
                    │  Postgres: one settings row per sub     │
                    └─────────────────────────────────────────┘
                                      ▲
                                      │ future Phase 2+
                                      │ GM_xmlhttpRequest
                                      │ @connect <app-host> only
                    Tampermonkey on docs.google.com
                    (still paints from local storage first)
```

Flow:

```
Google account
  → Google OAuth (openid email profile), authorization code + PKCE
  → server verifies ID token, discards Google access tokens
  → application session cookie (sub + email + expiry)
  → settings row keyed by google_sub
  → { color, opacity, updatedAt }
```

Clients in scope later: **website** and **Tampermonkey**. Extension: same API + `chrome.identity` later, not Phase 2.

---

## 3. Identity

**Explicit “Sign in with Google” only.**

Do not read:

- account chips, account menus, cookies on google.com
- `/u/0/`, `/u/1/` (session index, not an identity)
- any Sheets DOM as an email source

Canonical key: OpenID Connect **`sub`** from Google’s ID token.

Why `sub` over email:

- `sub` is Google’s stable subject for that client. Email can change, be aliased, or be withheld.
- Email is not unique over time; `sub` is unique per Google account + OAuth client.
- Using email as PK would merge or split rows if the user changes address.
- Email may still be stored for display (“Signed in as you@gmail.com”) and for support. It is **not** the primary key.

---

## 4. OAuth scopes and flows

Scopes (and only these):

```
openid
email
profile
```

Do not request Drive, Sheets, Gmail, Calendar, `drive.appdata`, or `userinfo.email` as a standalone Google API scope. The OpenID `email` and `profile` claims on the ID token are enough. Do not request `access_type=offline` / refresh tokens. This app does not call Google APIs after login.

### Website

**Authorization Code with PKCE**, confidential web client (client secret **server-only**).

1. `GET /api/auth/google` — generate `state` + PKCE `code_verifier`, stash in short-lived HttpOnly cookies, 302 to Google.
2. Google redirects to `GET /api/auth/google/callback`.
3. Server checks `state`, exchanges `code` at Google’s token endpoint (secret never leaves the server), verifies `id_token` (issuer, audience = client ID, nonce, expiry) via Google JWKS.
4. Read `sub`, `email`, `email_verified`, `name` / `picture` if present.
5. Upsert settings row if missing (defaults: `#1a73e8`, `"0.1"`).
6. Set **application** session cookie. Drop Google access token from memory. Do not persist Google tokens.
7. Redirect to a same-origin path (`/` or `/instant`), never to an open redirect.

This matches a Next.js App Router Route Handler, not a client-only Google Identity Services token in page JS.

### Tampermonkey (design only — do not implement now)

The userscript must **never** contain `GOOGLE_CLIENT_SECRET`, refresh tokens, or a service-account key.

Intended future model:

1. Colour panel offers “Sign in with Google” (optional, not a wall).
2. Open a **top-level tab** to `https://<app-host>/api/auth/google?src=userscript` (no page `fetch`).
3. User completes OAuth on the app origin (first-party).
4. App sets the session cookie on `<app-host>`.
5. Tab shows “You can close this window.”
6. Userscript later uses **`GM_xmlhttpRequest`** to `https://<app-host>/api/settings` so the request is made by the extension, with cookies for `<app-host>`, not `docs.google.com`.
7. `@connect` must be **exactly** the app host. Never `@connect *`.

Page `fetch` from Sheets remains forbidden (CSP + current tests).

---

## 5. Backend design

| Topic | Choice |
| --- | --- |
| Runtime | Node 22, same as `package.json` `engines` |
| API | Next.js App Router Route Handlers under `src/app/api/**/route.ts` |
| Auth/session | Encrypted, HttpOnly application cookie after Google ID-token verify. Cookie payload: `{ sub, email, exp }`. No Google tokens in the cookie |
| Database | One Postgres table (Neon or Vercel Postgres). No ORM required for a single table; a small SQL helper is enough |
| Deploy | Same Next app on Vercel (or any Node host). Serverless Route Handlers; no always-on process |
| CORS | Website: same-origin, no CORS. Tampermonkey `GM_xmlhttpRequest` is not a page CORS fetch; still **do not** send `Access-Control-Allow-Origin: *`. If a browser CORS preflight ever appears, allow only `https://<app-host>` |
| CSRF | Website mutating `PUT`: require `Origin`/`Referer` in `{ APP_ORIGIN, http://127.0.0.1:43173, http://localhost:43173 }` **or** a CSRF token bound to the session. `SameSite=Lax` covers normal website form/navigation. Tampermonkey cannot forge `GM_xmlhttpRequest`; still validate session |
| Session lifetime | **7 days** idle max; sliding refresh optional on `GET /api/settings`. Absolute max **30 days** then re-auth |
| Logout | `POST /api/auth/logout` clears session cookie. Does not call Google revoke unless we stored a Google refresh token (we will not). Local colour stays |
| Rate limit | Target **60 requests / minute / sub** (and per IP for unauthenticated auth routes). Return 429 |

### Environment variables (proposed)

No `.env.example` in this phase: `.gitignore` matches `.env*`, so an example file would not be committed until Phase 2 adds `!.env.example`.

**Server-only (never `NEXT_PUBLIC_`, never userscript):**

| Name | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Web OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Web OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Exact callback, e.g. `https://<app-host>/api/auth/google/callback` |
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | ≥32 random bytes for cookie encryption/signing |
| `APP_ORIGIN` | Canonical origin, e.g. `https://<app-host>` (redirect and Origin checks) |

**Safe to expose later (public):**

| Name | Purpose |
| --- | --- |
| Production app hostname | Needed in the userscript as a **literal** `@connect` and request URL (userscript is not bundled with Next env). Bake at release time, not a secret |

`NEXT_PUBLIC_GOOGLE_CLIENT_ID` is **not** required if all OAuth starts on the server.

---

## 6. Database design

Phase 2 uses **two tables** so account identity and highlight preferences stay separate, with `google_sub` as the canonical key in both (Phase 2 requirement). Email is still not unique.

```sql
-- Applied by npm run db:migrate from docs/schema.sql

CREATE TABLE users (
  google_sub TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE highlight_settings (
  google_sub TEXT PRIMARY KEY REFERENCES users(google_sub) ON DELETE CASCADE,
  color TEXT NOT NULL,
  opacity TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX highlight_settings_updated_at_idx
  ON highlight_settings (updated_at);
```

| Rule | Decision |
| --- | --- |
| Primary key | `google_sub` (opaque text) |
| Unique | PK implies unique `sub`. Do **not** unique-index email |
| Foreign keys | None |
| Required | `google_sub`, `color`, `opacity`, timestamps |
| Cardinality | **Exactly one** settings row per `sub` |
| Timestamps | `timestamptz`, exposed as UTC ISO-8601 (`2026-10-08T11:08:00.000Z`) |
| Updates | `UPDATE … SET color, opacity, email, updated_at = now() WHERE google_sub = $1` |
| Insert | On first successful login if no row; defaults `#1a73e8` / `0.1` |

`google_sub` is never parsed, never treated as an email, never logged in full in client analytics.

---

## 7. Settings validation (server must re-check)

Match the userscript, but **never trust the client**.

**Colour**

- Trim, lowercase, strip spaces.
- If no leading `#`, prepend `#`.
- Accept `^#[0-9a-f]{6}$` or `^#[0-9a-f]{3}$`.
- Canonical store form: **`#rrggbb`** (expand 3-digit).
- Reject `javascript:`, `url(`, `;`, `expression(`, anything else.

**Opacity**

- Current client: `Number(value)`, clamp 0.05–0.50, `String(Math.round(n * 100) / 100)` → `"0.1"`, `"0.28"`.
- Backend: accept JSON number or string; coerce with `Number`; reject non-finite; clamp **and** reject out-of-range rather than silently clamping on PUT (so the client sees 400 if it sent `9`). *Open decision:* clamp vs 400. **Recommendation: 400** for out-of-range and malformed; do not store unsanitised values.
- Canonical store/API form: **string with at most two decimal places**, e.g. `"0.1"`. Do **not** change the userscript representation in this phase.

**`seenTip`:** do not accept, store, or return. Per-device first-run tip.

**`updatedAt` on PUT:** see §8. Server does not persist a client-supplied timestamp as truth.

---

## 8. Synchronisation model (not implemented)

### Load

```
local GM / localStorage
  → paint immediately (today’s path)
  → if application session exists (future):
       GET /api/settings
       → reconcile
```

### Change

```
user changes colour/opacity
  → save local immediately (today’s saveConfig)
  → paint immediately
  → if session exists: PUT /api/settings in the background
```

Failures (network, 401, timeout, storage throw) **never** stop paint.

### Last-write-wins using `updatedAt`

| Topic | Rule |
| --- | --- |
| Who stamps | **Server** `now()` on successful PUT. Also set `updatedAt` on first insert |
| Client timestamp | Local may keep an `updatedAt` after a successful GET/PUT for compare only. **Do not** trust client clocks as the DB value |
| GET then local newer | Client PUTs local colour/opacity (no client timestamp field required; server stamps) |
| GET then cloud newer | Client applies cloud colour/opacity locally, then paints |
| Equal | Keep local (already on screen); no write |
| Clock skew | Because the server owns `updatedAt`, two devices compare **server** times from the last GET/PUT, not OS clocks |
| PUT body `updatedAt` | Optional hint. If present and **older** than the row’s `updatedAt`, respond **409** with the current row so the client can merge. If absent, overwrite (authenticated owner only). Recommendation: website/userscript **send** the last known server `updatedAt` as `baseUpdatedAt` to get 409 instead of clobbering |

Conflict payload (409):

```json
{
  "error": "conflict",
  "settings": {
    "color": "#217346",
    "opacity": "0.2",
    "updatedAt": "2026-10-08T11:00:00.000Z"
  }
}
```

No login wall: unsigned users stay on today’s local-only behaviour.

---

## 9. Authentication / session security

```
Google OAuth
  → server verifies ID token (JWKS, iss, aud, exp, nonce)
  → server creates application session
  → clients send that session, not Google tokens
```

### Cookie (website + future Tampermonkey against the same host)

| Flag | Value |
| --- | --- |
| Name | `fc_session` (exact name TBD in Phase 2) |
| HttpOnly | **Yes** |
| Secure | **Yes** in production (HTTPS). Dev on `http://127.0.0.1:43173` may omit Secure |
| SameSite | **Lax** first. If Tampermonkey cookie attach fails in Phase 2 verification, consider a documented SameSite=None; Secure **only** if measurements require it |
| Path | `/` |
| Max-Age | 7 days (see §5) |

Cookie contents: sealed/encrypted JSON (`sub`, `email`, `exp`), not a Google refresh token.

**Never place** client secret, refresh tokens, or session plaintext in: userscript source, client bundles, DOM, `localStorage`, GM storage.

### Logout / revocation

- Logout deletes the cookie. Local settings remain.
- No Google refresh token on file → nothing to revoke at Google. User can also remove the app under Google Account → Third-party access.
- Compromised `SESSION_SECRET` requires rotation and invalidates all sessions.

### OAuth hygiene

| Item | Rule |
| --- | --- |
| `state` | Cryptographic random, single-use, bound in a short-lived HttpOnly cookie, compared on callback |
| `nonce` | Random, in the auth request and ID token, verified |
| PKCE | S256 `code_challenge` / `code_verifier` |
| Redirect URI | Exact match to Cloud Console + `GOOGLE_REDIRECT_URI`. Allowlist only `APP_ORIGIN` paths |
| Origin | Reject `PUT` from unknown origins |

---

## 10. Google Cloud Console checklist (manual — you do this)

Do not create the project from this repo.

1. Create or select a Google Cloud project.
2. APIs & Services → OAuth consent screen.
3. User type: **External** (this tool is for any Google Sheets user). Use **Internal** only if you later restrict to one Workspace.
4. App name, user support email, developer contact.
5. Authorised domains: your production host (e.g. `vercel.app` plus a custom domain if any).
6. Scopes: `openid`, `email`, `profile` only.
7. Create **Web application** OAuth client.
8. Authorised JavaScript origins:
   - `http://127.0.0.1:43173`
   - `http://localhost:43173`
   - `https://<production-host>`
9. Authorised redirect URIs:
   - `http://127.0.0.1:43173/api/auth/google/callback`
   - `http://localhost:43173/api/auth/google/callback`
   - `https://<production-host>/api/auth/google/callback`
10. Tampermonkey does **not** need a separate “iOS/Android” client. It uses the **same Web client** via the site. A Chrome **Extension** client is only for a future unpacked/store extension (`chrome.identity`), not now.
11. While External + Testing: add your Google account under Test users.
12. Production: Google may require a public privacy policy URL and app verification for External apps used by people outside the test list. `openid`/`email`/`profile` are generally non-sensitive; verification is still required to leave Testing for a wide audience.
13. Give Cursor **later** (chat or host env, never commit): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN`.

---

## 11. Privacy (future policy — not collected today)

**This feature is not implemented.** Do not claim these data are collected in a live policy until Phase 2 ships.

When it ships, a privacy policy should cover:

| Data | Purpose |
| --- | --- |
| Google `sub` | Account key |
| Email | Display, support |
| Profile name/picture if returned | Optional display; may omit from DB |
| Colour, opacity | Sync preference |
| `created_at` / `updated_at` | Conflict resolution, debugging |
| Session cookie | Stay signed in |
| IP / logs | Security, rate limits, short retention |

Not in scope: spreadsheet contents, sheet IDs, Drive files, Gmail.

No complete public privacy policy is added in Phase 1 (none exists to update).

---

## 12. API contract (documentation only)

All settings routes require a valid session unless noted. JSON only. No `seenTip`.

### `GET /api/auth/google`

Unauthenticated. 302 to Google. Query `src=userscript` only changes post-login landing copy.

### `GET /api/auth/google/callback`

Google redirect. Success: 302 to `APP_ORIGIN`. Failure: 400/401 page or redirect with generic error (do not reflect `state` or codes in HTML).

### `POST /api/auth/logout`

Clears cookie. **200** `{ "ok": true }` even if already logged out.

### `GET /api/auth/session`

| Status | Body |
| --- | --- |
| 200 | `{ "authenticated": true, "email": "user@example.com" }` (no `sub` required on the client; optional `name`) |
| 200 | `{ "authenticated": false }` if no cookie (prefer 200 over 401 so the website can poll without error noise) |

### `GET /api/settings`

| Status | When | Body |
| --- | --- | --- |
| 200 | Authenticated, row exists | `{ "color": "#1a73e8", "opacity": "0.1", "updatedAt": "2026-10-08T11:08:00.000Z" }` |
| 200 | Authenticated, no row yet | Same, with defaults, **or** insert-on-read; prefer insert-on-first-login instead |
| 401 | No/invalid session | `{ "error": "unauthenticated" }` |
| 429 | Rate limit | `{ "error": "rate_limited" }` |
| 500 | Server fault | `{ "error": "server_error" }` |

### `PUT /api/settings`

Request:

```json
{
  "color": "#1a73e8",
  "opacity": "0.1",
  "baseUpdatedAt": "2026-10-08T10:00:00.000Z"
}
```

`baseUpdatedAt` optional; see §8.

| Status | When |
| --- | --- |
| 200 | Stored; body is the canonical row including **server** `updatedAt` |
| 400 | Missing/invalid colour or opacity |
| 401 | No/invalid session |
| 403 | Not used if the session `sub` is the only key (no user-id in the URL). Reserve 403 if a future admin path appears |
| 409 | `baseUpdatedAt` older than stored `updatedAt`; body includes current `settings` |
| 429 | Rate limit |
| 500 | Server fault |

No public GET-by-email. No list endpoint.

---

## 13. Tampermonkey security boundary (future change, not now)

Must remain true after Phase 2:

- Overlay `pointer-events: none`
- No `innerHTML` / `eval` / page `fetch`
- Colour sanitised before `style`
- Storage failure still paints
- Duplicate-install guard
- Immediate local paint

**Eventual** header additions (Phase 2+, after tests are rewritten):

```
@grant        GM_xmlhttpRequest
@connect      <production-app-host>
```

Never `@connect *`. Never `@grant GM_cookie` unless a later measured bug requires it (prefer letting `GM_xmlhttpRequest` send the app-host cookies).

Website `/instant` uses the same userscript file. That copy still must not `fetch`. Optional sign-in on `/instant` should use **same-origin** navigation to `/api/auth/google` (normal links), not page `fetch` inside the userscript.

---

## 14. Testing plan (future — do not change current tests in Phase 1)

### Authentication

- Happy path login creates session cookie
- Tampered/missing `state` → no session
- Bad callback `code` → no session
- Expired session → 401 on settings, highlighter still paints from local
- Logout clears cookie
- Invalid cookie ciphertext → treated as logged out

### Settings API

- Unauthenticated GET/PUT → 401
- Authenticated GET/PUT → 200
- Invalid colour / opacity → 400
- Session A cannot read/write session B (implied by cookie `sub`; add an explicit test)
- 409 when `baseUpdatedAt` is stale

### Client resilience

- Offline, 5xx, 401, timeout, `localStorage` throw → bands still draw

### Security

- Secret not in client bundle or userscript
- Session value not written to DOM / `localStorage`
- No `@connect *`
- No page `fetch` in userscript
- Colour XSS corpus still rejected
- No HTML injection

When network grants are added, **update** `compat-security.test.mjs` to allow **one** host in `@connect` and `GM_xmlhttpRequest` **only as a grant**, while still forbidding page `fetch` and `@connect *`.

---

## 15. Files

### Phase 1 (this change)

| File | Role |
| --- | --- |
| `docs/google-settings-architecture.md` | This document |
| `README.md` | Pointer in the Files table only |

### Phase 2 (website/backend — implemented)

| File | Role |
| --- | --- |
| `src/app/api/auth/google/route.ts` | Start OAuth |
| `src/app/api/auth/google/callback/route.ts` | Callback |
| `src/app/api/auth/logout/route.ts` | Logout |
| `src/app/api/auth/session/route.ts` | Session probe |
| `src/app/api/settings/route.ts` | GET/PUT settings |
| `src/lib/auth/*` | Cookie seal, ID token verify, origin checks |
| `src/lib/settings/*` | Validation + SQL + memory store for tests |
| `docs/schema.sql` | `users` + `highlight_settings` |
| `scripts/db-migrate.mjs` | `npm run db:migrate` |
| `.gitignore` | `!.env.example` |
| `.env.example` | Names only |
| `src/components/account-bar.tsx` | Optional sign-in / cloud settings |
| Tests | New API/auth tests; **userscript security tests unchanged** |

### Later phase (not this change)

| File | Role |
| --- | --- |
| `userscript/sheets-focus-cell.user.js` | Optional sign-in + `GM_xmlhttpRequest` **after** local paint |
| `userscript/README.md` | How optional sync works |

### Intentionally untouched in Phase 1

Painting, `saveConfig` / `loadStored`, colour panel behaviour, Apps Script, `extension/manifest.json` grants, existing security tests, `public/` copies (except they stay in sync because sources did not change).

---

## 16. Risks and open decisions

1. **Tampermonkey + cookies.** `SameSite=Lax` may or may not attach on `GM_xmlhttpRequest`. Phase 2 must verify in Chrome, Edge, Firefox, Safari before promising sync. Fallback: user signs in on the website first (first-party), then returns to Sheets.
2. **External OAuth Testing cap.** Until verification, only listed test users can sign in.
3. **Userscript is a static file.** Production `@connect` host is a release constant, not `process.env`.
4. **PUT 400 vs clamp** for opacity: this doc recommends 400.
5. **`baseUpdatedAt` vs blind overwrite:** recommended to send `baseUpdatedAt`.
6. **Auth.js vs small Route Handlers:** this doc prefers Route Handlers + `jose` + Google token endpoint to avoid a second user store. Revisit if OAuth maintenance hurts.
7. **Postgres vendor:** Neon vs Vercel Postgres — either is fine; need `DATABASE_URL`.
8. Do not scrape Sheets identity if cookie sync is hard; keep explicit sign-in.

---

## 17. Recommended Phase 3 (do not start automatically)

Phase 2 (this repo) shipped the website foundation. **Do not connect Tampermonkey yet.**

1. Configure Google Cloud + Postgres locally using the checklist in §10 and `.env.local`.
2. Verify website sign-in, session cookie, and GET/PUT `/api/settings` in a real browser (cloud-settings integration on the site only).
3. Only then: userscript network grants, `@connect` one host, background GET/PUT, tests updated.
4. Extension identity: later still.

Success for Phase 2: the website has a secure, testable Google-account backend; **the running highlighter is unchanged.**
