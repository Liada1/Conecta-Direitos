# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page Portuguese-language public-service guide ("cartilha") for LGBTQ+ rights, support
services, and safe spaces across the 9 municipalities of Serra da Ibiapaba, Ceará, Brazil. It is
authored as a **Claude Design canvas** artifact, not a conventional web app project.

The project is:

- `index.html` — the entire app: markup template + view-model logic, in one file. Originally
  authored as `Conecta Direitos.dc.html` (the Claude Design canvas convention); renamed to
  `index.html` so static hosts (Vercel/Netlify/GitHub Pages) serve it at the site root with no
  redirect and no URL-encoded space in the path. The content/format didn't change, just the name —
  it's still a dc-runtime document underneath.
- `support.js` — the vendored Claude Design canvas runtime (`dc-runtime`) that parses and boots
  the document in a plain browser regardless of its filename. **Generated file — do not
  hand-edit.** Its header says to rebuild via `cd dc-runtime && bun run build`, but no
  `dc-runtime` source tree exists in this project; treat `support.js` as a fixed, opaque
  dependency.
- `supabase-schema.sql` — the SQL to run once in a Supabase project's SQL Editor. Creates
  `denuncias` (the anonymous-report table) and `rate_limits` (support table for the Edge
  Function below), and deliberately grants the public `anon` key no access to either.
- `supabase/functions/submit-denuncia/index.ts` — a Supabase Edge Function; the *only* way a
  denúncia gets written (see "Anonymous reports" below).
- `_headers` — Netlify-style HTTP response headers (clickjacking protection via
  `X-Frame-Options`, etc.). Only takes effect if the host reads this convention (Netlify does;
  GitHub Pages does not — see "Security measures").

There is no `package.json`, build tool, linter, or test suite for the front end. There is nothing
to install or compile to preview the site. The Edge Function is Deno/TypeScript, deployed through
the Supabase dashboard or CLI — not part of the front-end build.

## Running / previewing

Open `index.html` directly in a browser (double-click it, or `file://` path) —
`support.js` is loaded via a relative `<script src="./support.js">` and boots the page client-side.
No dev server is required. There is no automated test suite; verify changes by opening the file
and clicking through the UI manually.

## Architecture of `index.html`

The file has two parts:

1. **Template** — everything inside `<x-dc>…</x-dc>`. This is HTML using the dc-runtime template
   dialect:
   - `{{ expr }}` — interpolation, bound to keys returned from the component's view-model.
   - `<sc-for list="{{ items }}" as="item" hint-placeholder-count="N">` — list rendering; the
     `hint-placeholder-count` is just a skeleton-loading hint, not app logic.
   - `<sc-if value="{{ cond }}" hint-placeholder-val="{{ false }}">` — conditional rendering.
   - `onClick="{{ handler }}"`, `onChange="{{ handler }}"`, `value="{{ state }}"` — event/state
     bindings resolved against the view-model object.
   - `style-hover="…"` — a dc-runtime-specific attribute for hover styles (plain inline `style`
     covers the base state; there is no separate CSS/stylesheet file).
   - `<helmet>…</helmet>` at the top of `<x-dc>` — head content (fonts, the Phosphor icon
     stylesheet, global `<style>` with the design tokens described below).

2. **Logic** — the `<script type="text/x-dc" data-dc-script data-props="{}">` block, defining
   `class Component extends DCLogic`. Key shape:
   - `state = { … }` — plain component state (React-like, but this is the dc-runtime base class,
     not raw React).
   - `renderVals()` — computes and returns the full view-model object consumed by `{{ }}` bindings
     in the template (derived lists, per-item styles, event handler closures, computed strings).
     This is the one method to read/edit when changing what the page shows or how it behaves.
   - Static data lives in module-level `const` objects above the class: `CITIES` (per-municipality
     `center` + `pins`), `STATE_CONTACTS`, `TRAILS`, `TEMPLATES`, `GLOSSARY`, `DOS`/`DONTS`,
     `KINDS`, `RIGHTS`, `HEALTH`. Add/edit content here rather than inline in the template.
   - Styling is computed inline as CSS strings from helper methods (`chip()`, `iconBox()`) using
     `oklch()` colors and a small `PALETTE` map keyed by category tone (`apoio` / `saude` / `lazer`).
     There is no CSS file or class-based stylesheet — everything is inline `style` strings built in
     JS.
   - `componentDidMount` calls `initMap()` once; `componentDidUpdate` calls `syncMap()` on every
     render. There is no icon-hydration step — icons are Phosphor, rendered via pure CSS (see
     "Design system" below), unlike the Lucide setup this replaced which needed
     `window.lucide.createIcons()` re-run after every update.

## Design system

Redesigned away from the generic "AI-generated SaaS" look (Plus Jakarta Sans headings, full-pill
buttons everywhere, colored glow shadows, purple gradient-ish eyebrow badges, whole-section color
washes) toward a more restrained editorial style, while keeping it minimal:

- **Fonts** (Google Fonts, loaded in `<helmet>`): `Newsreader` (serif) for all headings —
  `font-family:Newsreader,Georgia,serif` — `Karla` for body/UI text, `'JetBrains Mono'` for
  phone numbers, the denúncia protocol, and the eyebrow label. Don't reintroduce Plus Jakarta
  Sans/Inter/Roboto for headings — that combination is exactly the look this was moved away from.
- **Icons**: `@phosphor-icons/web` (bold weight), loaded as a CSS icon font via
  `<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css">`
  with an SRI `integrity` hash. Markup is `<i class="ph-bold ph-{name}">` — **not**
  `data-lucide`, which this replaced. Icon names differ from Lucide's (e.g. `heart-pulse` →
  `heartbeat`, `trees` → `park`, `send` → `paper-plane-tilt`); the full old→new mapping used for
  the migration is not stored anywhere in the repo — if you need to add a new icon, look it up
  directly at the phosphor-icons/core GitHub repo's `assets/bold` directory (bold-suffixed SVG
  filenames = the class name without `-bold`) rather than guessing a name.
- **Color tokens**: CSS custom properties on `:root` in the `<style>` block — `--ink`,
  `--ink-soft`, `--ink-faint`, `--paper`, `--paper-raised`, `--line`, `--accent`, `--accent-soft`.
  Prefer these (`var(--ink)` etc.) over new literal `oklch(...)` values for anything structural
  (text color, card backgrounds, borders). The `PALETTE` object (`apoio`/`saude`/`lazer` category
  colors) is intentionally separate and untouched — those stay as small, scarce accents on chips,
  icon boxes, and map pins, never as a full-section background wash.
- **Shape/shadow discipline**: primary buttons and cards use small radii (`7px` buttons, `10px`–
  `12px` cards), not the `999px` pill shape — pill radius is now reserved for small filter
  chips/tags only (`chip()`) and the city picker in the header, matching how tags/badges are
  meant to look. Buttons carry no colored glow `box-shadow`; the old
  `box-shadow:0 3px 10px oklch(.../0.28)` pattern on CTAs was removed everywhere.

## The map (`#mapa`)

Real Leaflet + OpenStreetMap map (loaded via CDN in `<helmet>`, no API key needed), rendered into
`<div id="leaflet-map">`. `initMap()` creates the `L.map`/tile layer/marker `L.layerGroup` once;
`syncMap()` re-centers on `CITIES[city].center` and repopulates markers on every update, but
**only for pins matching the active category filter** (`data.pins.filter(p => p.cat === filter)`)
— that's the "só os pontos necessários" behavior, not a dimmed/full list.

- `CITIES[cityName].center` is a real `[lat, lng]` — sourced from Wikipedia/Wikidata/IBGE/IPECE
  for each municipality's town center.
- All 9 municipalities' `role`/`name`/`detail` (address)/`phone` per pin come from two PDFs the
  site owner supplied as verified data ("dados oficiais cruzados — Secretarias, SSPDS-CE e Diários
  Oficiais, ago/2026"): `Guia_Oficial_Apoio_Saude_Lazer_Ibiapaba_v2.pdf` (6 municípios) and
  `Guia_Oficial_Ibiapina_Carnaubal_Croata.pdf` (the other 3).
- **The GPS coordinates that were printed in those PDFs turned out to be unreliable and were
  discarded** — spot-checking Tianguá's CREAS address against real geocoding put it over 1km from
  the PDF's claimed coordinate (verified via Nominatim, `nominatim.openstreetmap.org/search`).
  Every pin's `lat`/`lng` in the code now comes from actually geocoding the PDF's address text
  against OpenStreetMap. Small towns in this region often have no street-level OSM coverage; where
  geocoding found nothing, the pin falls back to `CITIES[city].center` and carries `approx: true`.
  **Never treat a PDF-supplied GPS pair as trustworthy on its own — always geocode the address
  text instead** if more pins are added later.
- `p.approx` pins are visibly marked, not silently placed as if precise: dashed/translucent marker
  + a "localização aproximada" line in the Leaflet popup (`syncMap()`), and the same note under the
  pin in the `#mapa` list (`<sc-if value="{{ p.approx }}">`). Keep both in sync if you touch either.
- `cityFacts` (the "Ficha do município" card) is derived directly from `data.pins` — never a
  separately-authored array — specifically so it can't drift into unverified claims. If you add a
  new confirmed pin, its `role`/`name` show up there automatically.
- Marker popups are built as raw HTML strings via `escapeHtml()` — keep using it for any pin field
  that ends up in a popup, since `bindPopup()` sets `innerHTML`.
- Dropped entirely for lack of a verified source (don't reintroduce without one): operating hours
  per pin, and the "atende por nome social" / "confirme antes" badge. Only `phone` is shown, and
  only when the pin has one (`p.hasPhone`) — several real lazer/turismo pins have no phone in the
  source PDF and intentionally show none rather than a placeholder.

## Anonymous reports (`#denuncia`) — real backend via a Supabase Edge Function

`submit()` → `submitDenuncia()` POSTs to `${SUPABASE_URL}/functions/v1/submit-denuncia`, **not**
directly to `/rest/v1/denuncias`. This changed after the first working version (which did POST
straight to the table with an anon INSERT policy) — that worked, but meant anyone with the anon
key (visible in page source, by design) could script arbitrary volumes of fake denúncias straight
against the REST API. The Edge Function is what actually prevents that:

- `supabase-schema.sql` drops the anon INSERT policy on `denuncias` entirely — a direct REST POST
  to the table now gets rejected by RLS regardless of who sends it or what key they use, anon or
  otherwise (short of the service_role key, which never leaves the Edge Function's environment).
- `supabase/functions/submit-denuncia/index.ts` is the only path with write access. It hashes the
  caller's IP (SHA-256 + a salt, via `RATE_LIMIT_SALT` env var if set — never stores the raw IP),
  counts recent rows in `rate_limits` for that hash, and rejects with HTTP 429 past **5 submissions
  per IP per 30 minutes**. Only then does it insert into `denuncias` using the service_role client
  (which bypasses RLS) and log the attempt in `rate_limits`. It also opportunistically prunes
  `rate_limits` rows older than twice the window on each call, so it never needs a separate cron.
- The honeypot (see "Security measures") and this rate limit are complementary, not redundant: the
  honeypot catches naive automated form-fillers; the Edge Function's limit is what actually holds
  even against someone bypassing the browser and scripting the API directly.
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` constants near the top of the `<script>` are filled in with
  the project's live values. The anon key is still sent (as `apikey`/`Authorization`) because
  Supabase's gateway requires *some* valid key to invoke any Edge Function — the function's own
  rate-limit logic is the real gate, not that header. If the constants are ever blanked or point
  at a different project, submitting throws and the form shows a real error state (`sendError`) —
  it does not silently fake success.
- The payload sent is `{ city, kind, description, place, protocol }` — no IP, name, email, or
  device info — to honor the page copy's anonymity promise. `protocol` is generated client-side
  (`CD-######`, random) *before* the request and included in the payload specifically so the value
  shown to the user is also stored server-side — the copy promises it can be used to "acompanhar
  em um posto de atendimento," which only works if staff can look it up later. Don't add fields or
  client-side storage (`localStorage`, analytics, etc.) to this flow without revisiting that copy.
- Deploying the function is a manual step outside this repo's control (Supabase dashboard's Edge
  Functions tab, or `supabase functions deploy`) — see the instructions at the bottom of
  `supabase-schema.sql`. Without it deployed, the form has no working backend at all (not even the
  old direct-insert path, since that policy is gone).

## Security measures in place

- **CSP** (`<meta http-equiv="Content-Security-Policy">` in `<head>`): restricts script/style/font/
  img/connect sources to only what's actually used (self, the pinned unpkg CDN, Google Fonts, the
  OSM tile servers, the Supabase project). Includes `'unsafe-eval'` in `script-src` — this is
  required, not optional: `support.js` runs the component logic via `new Function(...)`, and
  removing `unsafe-eval` breaks the entire page (map, filters, form). `connect-src` hardcodes the
  Supabase project URL — if you ever rotate `SUPABASE_URL`, update the CSP too (there's a comment
  next to it as a pointer).
- **SRI**: the three CDN resources (Leaflet CSS/JS, Phosphor CSS) carry `integrity="sha384-…"` +
  `crossorigin="anonymous"`. If you bump a pinned CDN version, you must recompute the hash (e.g.
  `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`) or the resource will silently
  fail to load.
- **Denúncia anti-spam honeypot**: a visually-hidden (`clip:rect(0,0,0,0)`, off in the accessibility
  tree via `aria-hidden`) input bound to `state.hp`. If it's non-empty on submit, `submit()`
  pretends success (`sent: true`) without calling the Edge Function at all — don't "fix" this into
  throwing an error, the whole point is to not tip off whatever filled it.
- **Real rate limiting**: enforced server-side by the `submit-denuncia` Edge Function, not just
  the honeypot — see "Anonymous reports" above. This is the part that holds even against someone
  scripting requests directly, which the honeypot alone does not stop.
- `frame-ancestors` is **not** in the CSP `<meta>` tag — browsers ignore that directive when it
  arrives via `<meta>` rather than a real HTTP header (confirmed empirically: Edge printed exactly
  that warning to console when it was there). `_headers` sets `X-Frame-Options: DENY` instead,
  which works from a `<meta>`-equivalent file *only* on hosts that honor Netlify's `_headers`
  convention. On GitHub Pages (no custom headers support at all) or Vercel (needs `vercel.json`
  instead), clickjacking protection needs a different mechanism — don't assume `_headers` alone
  covers every hosting choice.

## Content and behavior constraints to preserve

This is a safety-oriented resource for a vulnerable audience, and several behaviors are load-bearing
promises made in the page copy itself — don't break them incidentally while editing:

- **"Saída rápida" (quick exit)** buttons call `quickExit()`, which does
  `window.location.replace("https://www.google.com")` — an immediate, non-history-preserving
  navigation away from the page for user safety. Keep it instant and keep using `replace` (not
  `href`/`assign`) so the page doesn't stay in browser history.
- City/municipality data (`CITIES`), phone numbers, and legal references (e.g. Decreto nº
  8.727/2016, Portaria nº 1.820/2009) are real-world factual content — treat edits to these as
  content changes requiring the same care as the prose, not just code. Per-service pin data (6 of
  9 municipalities) is sourced from a document the site owner supplied; the other 3 are
  intentionally empty pending the same kind of verified source (see "The map" above) — never fill
  a gap like that with invented specifics just to make a list look complete.
