# Android App Adapter

A thin Adapter that accepts an Android App API base URL and App token, proves the connection by
fetching `/api/app/apis?format=md`, and publishes the resulting descriptor as the
`android.app.api` Capability. When the App exposes the versioned
`GET /api/app/config/schema` contract, the WebUI also renders generic controls from that schema
and calls each field's declared read/write endpoint.

The optional Assistant Event Routing panel reads the App's live source event catalog and stores
default/per-event loopback HTTP targets in Adapter-private config. Its namespaced
`/assistant/call` ingress is activated only when the user selects “Use Adapter Router”; replacing
an existing App endpoint requires confirmation. The Adapter never stores per-event routes in App
config, hardcodes App event names, or forwards the App bearer token to a route target. GET/POST are
supported, redirects and non-loopback URLs are rejected, and an unconfigured router returns a
diagnostic `assistant_route_not_configured` response.

The schema bridge keeps the App token in the Package backend. Older Apps without the schema keep
the existing connection and API catalog UI, with a message that App Parameters are unavailable.
The generic renderer does not contain App config key lists. The dedicated Assistant Router is the
only feature-specific policy in this Adapter.

Other Packages invoke that Capability to obtain the base URL, token, and current Markdown catalog,
then call the Android App directly. This Adapter contains no audio or speech workflow.

Current state: Dev Workspace review only. It is not an immutable Release and is not formally
installed.
