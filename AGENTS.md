# Android App Adapter Package instructions

## Responsibility

This Package is an authenticated entry to one replaceable Android App API. It owns the App base URL,
external App token, proven Markdown API catalog, `android.app.api` Capability descriptor, a
schema-driven renderer for App config fields, and the opt-in Assistant Event Router. Assistant
source names and labels come from `GET /api/app/assistant/events`; do not hardcode App event lists.
The router policy stays in this Package and its route is reached through Framework's namespaced
package dispatch. The explicit “Use Adapter Router” operation may update only the existing
`assistant_primary_endpoint`, with confirmation before replacing a non-empty value.

It must not implement or proxy PCM, RMS, KWS, VAD, ASR, TTS, Chat, or general-purpose workflows.
The Assistant Router accepts only `assistant.primary`, GET/POST, loopback cleartext HTTP, and a
bounded timeout. It rejects unsafe URL components and redirects; when no route is configured it
returns `assistant_route_not_configured` without crashing.

## Credential boundary

- The Framework System Key belongs to Browser Session/Core and is never requested by this page.
- The App token is an external provider credential. The WebUI uses a blank password input marked
  `data-provider-credential`, submits it once through `window.TermuxOS.api`, and immediately clears it.
- Never use `localStorage`, `sessionStorage`, query parameters, logs, source defaults, or public
  read responses for the App token.
- Persist the App token only through `context.configFile()` with owner-only permissions.
- Only the authenticated `android.app.api` Action may return the full descriptor to trusted
  Package consumers, because that transfer is this Adapter's explicit responsibility.

## Observing the App (docs/056)

`adapter/speech-states.mjs` publishes `speech.tts` and `audio.output.route`. It **subscribes** to
the App's `/ws/android/events`; it does not poll.

- ⚠ **This Adapter runs inside the framework process.** It has no process of its own, so anything
  it schedules is charged to `node src/server.mjs` and is invisible in `ps`. The previous 100 ms
  poller cost ~20% of a core there and took four rounds to attribute. Never add a bare timer here.
- ⚠ **Read the field names the App actually emits.** It sends `active` / `phase` and
  `routed_device` / `preferred_device`. The previous reader looked for `speaking` /
  `routed_output_device`, so both signals were frozen at `false` / `unknown` from day one and echo
  suppression never fired — silently, because a missing field is `undefined` and `undefined === true`
  is just `false`. `test/self-test.mjs` pins a byte-for-byte capture of a real device response;
  keep it captured, never hand-written.
- Config is read once per connection attempt (App updates rotate the token), not per observation.
- On disconnect, do **not** clear the states: an assertion must go stale rather than flip to
  `false`, so the guard suppresses; the resting `false` carries no `max_age_ms` and stays live.

## Runtime and Workspace

- This Adapter has no Stage Service and no Package-owned port.
- A Dev page runs at `/packages/<id>@<slug>/`; derive the API instance from `location.pathname`.
- Public Package routes return masked connection state. A failed or stale credential hides the
  cached Markdown instead of presenting it as a live catalog.
- Assistant route settings live in a separate owner-only file returned through authenticated Package
  routes. The route target never receives the App Authorization header. A missing event catalog hides
  only dynamic event rows; default routing and the generic parameter panel remain available.
- Keep the page portrait-phone-first and under the Framework Adapters group.
- The WebUI uses keyboard-accessible tabs: Connection, App Parameters, Assistant Routing, App API Catalog,
  and Diagnostics / Boundary. Remember the selected tab in the URL hash; never use browser storage.
- In Connection, the editable URL is the Adapter connection target. Show the connected App's reported
  `api_base_url` / `api_port` separately; a mismatch is diagnostic and never auto-overwrites the target.
  Changing the App API listener port belongs in the App Settings `App API listener` card. The Framework
  Package page route is a separate address and does not configure either endpoint.
- Diagnostics / Boundary is read-only: show connection, token-set state, App/schema versions, event and
  generic-field counts, plus App/Adapter/Speech/Framework ownership. Do not add controls there.
- The generic parameter panel accepts only `ui_location=ADAPTER_GENERIC_UI`, or a missing location paired
  with `generic_ui_safe=true` and an approved owner. App-owned and dedicated UI fields stay out of that
  panel. Speech, sensitive, internal, deprecated, and retired fields remain excluded as a fallback.
- Schema fields in category `assistant` are shown in the Assistant Routing tab, not duplicated in App Parameters.

## Checks

- `termux-os-sdk test github.termux-os.adapter.android-app`
- `termux-os-sdk doctor github.termux-os.adapter.android-app`
- `node test/ui-contract-test.mjs`

Do not create a Release or install it until the user has reviewed the Dev Workspace behavior.
