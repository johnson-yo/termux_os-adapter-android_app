# Android App Adapter

A thin Adapter that accepts an Android App API base URL and App token, proves the connection by
fetching `/api/app/apis?format=md`, and publishes the resulting descriptor as the
`android.app.api` Capability. The editable URL is the Adapter connection target; the App-owned
loopback API listener and its configurable port are shown separately from the App's status response.
A target/listener mismatch is diagnostic and never silently rewrites the target. When the App exposes the versioned
`GET /api/app/config/schema` contract, the WebUI also renders generic controls from that schema
and calls each field's declared read/write endpoint.
The WebUI is split into Connection, App Parameters, Assistant Routing, App API Catalog, and
Diagnostics / Boundary tabs. Selection is keyboard-accessible and remembered in the URL hash.
App Parameters accepts only fields declared for `ADAPTER_GENERIC_UI`, or
fields with no location that explicitly opt in as safe generic fields; App-owned and dedicated UI
fields are excluded. Assistant-category fields are shown in the Assistant Routing tab. Speech
product fields (Gate, segment, Speech, ASR, trigger, and mic/audio lifecycle controls), secrets,
internal fields, and retired fields are filtered as a safety backstop. Explicitly generic fields,
including low-level audio configuration, remain schema-driven.

Diagnostics / Boundary is read-only and reports connection/token state, the actual App-reported listener,
App and schema versions, Assistant event count, and generic rendered/filtered counts. It documents that App
core settings stay in App, Speech product settings stay in termux-speech, Assistant route policy stays in
this Adapter, and Framework Core does not own App product workflow.

The optional Assistant Event Routing panel reads the App's live source event catalog and stores
default/per-event loopback HTTP targets in Adapter-private config. Its namespaced
`/assistant/call` ingress is activated only when the user selects “Use Adapter Router”; replacing
an existing App endpoint requires confirmation. The Adapter never stores per-event routes in App
config, hardcodes App event names, or forwards the App bearer token to a route target. GET/POST are
supported, redirects and non-loopback URLs are rejected, and an unconfigured router returns a
diagnostic `assistant_route_not_configured` response.

The schema bridge keeps the App token in the Package backend. Older Apps without the schema keep
the existing connection and API catalog UI, with a message that App Parameters are unavailable.
The generic renderer does not contain App config key lists. Per-event routing remains Adapter-owned
and the dedicated Assistant Router stays separate from generic App configuration.

Other Packages invoke that Capability to obtain the base URL, token, and current Markdown catalog,
then call the Android App directly. This Adapter contains no audio or speech workflow.

Current state: Dev Workspace review only. It is not an immutable Release and is not formally
installed.
