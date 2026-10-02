/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: Isolated App API and loopback target fixtures plus dynamic event catalogs
 * [OUTPUT]: Host evidence for namespaced Assistant ingress, routing policy, URL safety, UI models, and explicit activation
 * [POS]: Package-level Assistant router contract test; it never contacts or modifies a device
 * [PROTOCOL]: Keep event names fixture-driven and prove the App token never reaches browser responses or targets
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from '../package.mjs';
import { saveConnected } from '../adapter/config.mjs';
import {
  dispatchAssistantCall, loadAssistantRouting, normalizeAssistantEndpoint, routerIngressUrl,
  ROUTER_INGRESS_PATH, ROUTER_TIMEOUT_MS, saveAssistantRouting, selectAssistantRoute,
} from '../adapter/assistant-routing.mjs';
const routingBrowserSource = fs.readFileSync(
  fileURLToPath(new URL('../web/assistant-routing.js', import.meta.url)), 'utf8');
const appBrowserSource = fs.readFileSync(fileURLToPath(new URL('../web/app.js', import.meta.url)), 'utf8');
const { buildAssistantEventRows, normalizeEventCatalog } = await import(
  `data:text/javascript;base64,${Buffer.from(routingBrowserSource).toString('base64')}`);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-app-assistant-routing-'));
const connectionFile = path.join(tempDir, 'connection.json');
const routingFile = path.join(tempDir, 'assistant-event-routing.json');
const token = 'private-app-token-fixture';
const ipv4 = (...octets) => octets.join('.');
const loopbackV4 = ipv4(127, 0, 0, 1);
const alternateLoopbackV4 = ipv4(127, 9, 8, 7);
const privateV4 = ipv4(192, 168, 1, 9);
const events = [
  { name: 'fixture_button', label: 'Fixture button', description: 'A fixture event.', system_origin: true },
  { name: 'future_source', label: 'Future source', description: 'A future event.', system_origin: false },
];
const appValues = { assistant_primary_endpoint: '' };
let catalogAvailable = true;
const targetRequests = [];

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const targetServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  targetRequests.push({
    url: req.url,
    method: req.method,
    headers: req.headers,
    body: Buffer.concat(chunks).toString('utf8'),
  });
  if (req.url === '/redirect') {
    res.writeHead(302, { Location: '/followed' }).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
});
await new Promise((resolve) => targetServer.listen(0, loopbackV4, resolve));
const targetBase = `http://${loopbackV4}:${targetServer.address().port}`;

const schema = {
  schema: 'termux-os.app-config-schema.v1', schema_version: '1.0.0', read_only: true,
  entries: [{
    key: 'assistant_primary_endpoint', type: 'string', default: '', editable: true,
    category: 'assistant', owner: 'FRAMEWORK_POLICY', ui_location: 'ADAPTER_GENERIC_UI',
    description: 'Shared Assistant endpoint.', validation: { kind: 'loopback_http_url' },
    read_endpoint: 'GET /api/app/config', write_endpoint: 'POST /api/app/config',
  }],
};
const appServer = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { ok: false, error: 'unauthorized' });
  if (req.url === '/api/app/apis?format=md') return res.writeHead(200, { 'Content-Type': 'text/markdown' }).end('# App API\n');
  if (req.url === '/api/app/status') return json(res, 200, { ok: true, data: { app: 'fixture' } });
  if (req.url === '/api/app/assistant/events' && req.method === 'GET') {
    return catalogAvailable
      ? json(res, 200, { ok: true, data: { events } })
      : json(res, 404, { ok: false, error: 'not_found' });
  }
  if (req.url === '/api/app/config/schema' && req.method === 'GET') return json(res, 200, { ok: true, data: schema });
  if (req.url === '/api/app/config' && req.method === 'GET') return json(res, 200, { ok: true, data: { ...appValues, termux_os_run_token: token } });
  if (req.url === '/api/app/config' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    Object.assign(appValues, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
    return json(res, 200, { ok: true, data: { ...appValues } });
  }
  return json(res, 404, { ok: false, error: 'not_found' });
});
await new Promise((resolve) => appServer.listen(0, loopbackV4, resolve));
saveConnected(connectionFile, {
  baseUrl: `http://${loopbackV4}:${appServer.address().port}`, token, catalogMd: '# App API\n',
});

const registered = new Map();
const configs = new Map([
  ['android-app-connection.v1.json', connectionFile],
  ['assistant-event-routing.v1.json', routingFile],
]);
const originalWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class MockWebSocket { close() {} };
let lifecycleStop = null;
await register({
  configFile: (name) => configs.get(name),
  actions: { register() {} },
  lifecycle: { register(stop) { lifecycleStop = stop; } },
  capabilities: { provide() {} },
  routes: { register(method, route, handler) { registered.set(`${method} ${route}`, handler); } },
  states: { set() {} },
});

const invoke = async (method, route, body = undefined, headers = {}) => {
  const handler = registered.get(`${method} ${route}`);
  assert.equal(typeof handler, 'function', `registered route ${method} ${route}`);
  let reply;
  await handler({ method, headers, socket: { localPort: 8980 } }, {}, {
    json(_res, status, payload) { reply = { status, payload }; },
    async readBody() { return body; },
  });
  return reply;
};

assert.equal(ROUTER_INGRESS_PATH, '/api/packages/github.termux-os.adapter.android-app/assistant/call');
assert.equal(registered.has('GET /assistant/call'), true, 'namespaced GET ingress is registered by the Adapter package');
assert.equal(registered.has('POST /assistant/call'), true, 'namespaced POST ingress is registered by the Adapter package');
assert.equal(routerIngressUrl(8980), `http://${loopbackV4}:8980${ROUTER_INGRESS_PATH}`);
assert.equal(ROUTER_TIMEOUT_MS, 5000, 'router request timeout is bounded');

assert.equal(normalizeAssistantEndpoint('http://localhost:8980/run'), 'http://localhost:8980/run');
assert.equal(normalizeAssistantEndpoint(`http://${alternateLoopbackV4}:80/run`), `http://${alternateLoopbackV4}/run`);
assert.equal(normalizeAssistantEndpoint('http://[::1]:8980/run'), 'http://[::1]:8980/run');
for (const invalid of [
  `https://${loopbackV4}/run`, 'file:///tmp/run', 'shell://localhost/run', 'javascript:alert(1)',
  'intent://localhost/run', 'tos://localhost/run', `http://${privateV4}/run`,
  `http://user@${loopbackV4}/run`, `http://${loopbackV4}/run?x=1`, `http://${loopbackV4}/run?`,
  `http://${loopbackV4}/run#fragment`,
]) assert.throws(() => normalizeAssistantEndpoint(invalid), /assistant_endpoint_invalid/);

const saved = saveAssistantRouting(routingFile, {
  default_endpoint: `${targetBase}/default`,
  event_routes: { fixture_button: `${targetBase}/event`, future_source: '' },
});
assert.equal(saved.default_endpoint, `${targetBase}/default`);
assert.equal(loadAssistantRouting(routingFile).event_routes.fixture_button, `${targetBase}/event`);
assert.equal((fs.statSync(routingFile).mode & 0o077), 0, 'route config is owner-only');
assert.equal(selectAssistantRoute(saved, 'fixture_button').kind, 'event');
assert.equal(selectAssistantRoute(saved, 'future_source').kind, 'default', 'blank event route uses default');
assert.equal(selectAssistantRoute(saved, 'unknown_source').kind, 'default', 'unknown source uses default');
assert.equal(selectAssistantRoute(saved, '').kind, 'default', 'old App without source uses default');

const eventCall = await dispatchAssistantCall({
  routing: saved,
  method: 'POST',
  headers: {
    'X-Termux-OS-Assistant-Action': 'assistant.primary',
    'X-Termux-OS-Assistant-Source': 'fixture_button',
    authorization: `Bearer ${token}`,
  },
  body: { action_id: 'assistant.primary' },
});
assert.equal(eventCall.status, 200);
assert.equal(eventCall.payload.route, 'event');
assert.equal(targetRequests.at(-1).url, '/event');
assert.equal(targetRequests.at(-1).headers['x-termux-os-assistant-source'], 'fixture_button');
assert.equal(targetRequests.at(-1).headers.authorization, undefined, 'App credential is never forwarded to route targets');
assert.equal(targetRequests.at(-1).body, '{"action_id":"assistant.primary"}', 'router forwards only the fixed action envelope');

const oldAppCall = await dispatchAssistantCall({
  routing: saved, method: 'POST', headers: {}, body: { action_id: 'assistant.primary' },
});
assert.equal(oldAppCall.status, 200);
assert.equal(oldAppCall.payload.route, 'default', 'missing source uses default for old App');
assert.equal(targetRequests.at(-1).url, '/default');

const unknownCall = await dispatchAssistantCall({
  routing: saved, method: 'POST', headers: { 'x-termux-os-assistant-source': 'future_unlisted_event' },
  body: { action_id: 'assistant.primary' },
});
assert.equal(unknownCall.status, 200);
assert.equal(unknownCall.payload.route, 'default', 'unknown source is not an error');

const getCall = await dispatchAssistantCall({ routing: saved, method: 'GET', headers: { 'x-termux-os-assistant-source': 'fixture_button' } });
assert.equal(getCall.status, 200);
assert.equal(targetRequests.at(-1).method, 'GET');
assert.equal(targetRequests.at(-1).url, '/event');
assert.equal(targetRequests.at(-1).headers.authorization, undefined);

const redirectConfig = { ...saved, event_routes: {}, default_endpoint: `${targetBase}/redirect` };
const redirectCall = await dispatchAssistantCall({ routing: redirectConfig, method: 'GET' });
assert.equal(redirectCall.status, 502);
assert.equal(redirectCall.payload.error, 'assistant_redirect_rejected');
assert.equal(targetRequests.some((request) => request.url === '/followed'), false, 'redirect was not followed');

const noRoute = await dispatchAssistantCall({ routing: { default_endpoint: '', event_routes: {} }, method: 'POST', body: { action_id: 'assistant.primary' } });
assert.equal(noRoute.status, 409);
assert.equal(noRoute.payload.error, 'assistant_route_not_configured', 'unset routes fail diagnostically without crashing');
const invalidAction = await dispatchAssistantCall({ routing: saved, method: 'POST', body: { action_id: 'other.action' } });
assert.equal(invalidAction.status, 400, 'router does not accept an automation/action DSL');

const routeSave = await invoke('POST', '/assistant/routing', {
  default_endpoint: `${targetBase}/default`, event_routes: { fixture_button: `${targetBase}/event` },
});
assert.equal(routeSave.status, 200);
const packageEventCall = await invoke('POST', '/assistant/call', { action_id: 'assistant.primary' }, {
  'x-termux-os-assistant-action': 'assistant.primary',
  'x-termux-os-assistant-source': 'fixture_button',
});
assert.equal(packageEventCall.status, 200);
assert.equal(packageEventCall.payload.route, 'event', 'registered package ingress dispatches to the event target');
const packageOldAppCall = await invoke('POST', '/assistant/call', { action_id: 'assistant.primary' });
assert.equal(packageOldAppCall.status, 200);
assert.equal(packageOldAppCall.payload.route, 'default', 'registered package ingress defaults when old App has no source header');
assert.equal((await invoke('GET', '/assistant/routing')).payload.routing.event_routes.fixture_button, `${targetBase}/event`);
assert.equal((await invoke('GET', '/assistant/routing')).payload.event_catalog.available, true);
assert.equal(JSON.stringify((await invoke('GET', '/assistant/routing')).payload).includes(token), false,
  'public route state never returns the App token');

const activated = await invoke('POST', '/assistant/routing/use', { replace_existing: false });
assert.equal(activated.status, 200);
assert.equal(activated.payload.endpoint, routerIngressUrl(8980));
assert.equal(appValues.assistant_primary_endpoint, routerIngressUrl(8980), 'explicit button writes only the shared endpoint');
assert.equal(Object.keys(appValues).some((key) => key.startsWith('assistant_trigger_')), false,
  'App persists no per-event routes');

appValues.assistant_primary_endpoint = `http://${loopbackV4}:8980/existing`;
const rejectedReplace = await invoke('POST', '/assistant/routing/use', { replace_existing: false });
assert.equal(rejectedReplace.status, 409, 'existing endpoint is protected unless replacement is explicit');
assert.equal(appValues.assistant_primary_endpoint, `http://${loopbackV4}:8980/existing`);
const confirmedReplace = await invoke('POST', '/assistant/routing/use', { replace_existing: true });
assert.equal(confirmedReplace.status, 200);
assert.equal(appValues.assistant_primary_endpoint, routerIngressUrl(8980));

catalogAvailable = false;
const degraded = await invoke('GET', '/assistant/routing');
assert.equal(degraded.status, 200);
assert.equal(degraded.payload.event_catalog.available, false, 'missing App event catalog degrades only the event list');
assert.equal(degraded.payload.routing.default_endpoint, `${targetBase}/default`);
assert.equal((await invoke('GET', '/parameters')).payload.parameters.available, true,
  'generic parameter UI still works when the event catalog is missing');

const normalized = normalizeEventCatalog({ available: true, events });
assert.equal(normalized.available, true);
assert.deepEqual(buildAssistantEventRows(normalized, { fixture_button: `http://${loopbackV4}:1/event` })
  .map((row) => row.name), ['fixture_button', 'future_source']);
assert.equal(buildAssistantEventRows(normalized, { fixture_button: `http://${loopbackV4}:1/event` })[0].endpoint,
  `http://${loopbackV4}:1/event`);
assert.equal(buildAssistantEventRows({ available: false, reason: 'missing', events: [] }, {}).length, 0);
assert.equal(/push_to_talk|assist_gesture|automotive_system_ui|keyguard_bridge/.test(appBrowserSource), false,
  'Adapter WebUI contains no fixed App event list');
assert.equal(normalizeEventCatalog({ available: false, reason: 'missing', events: [] }).available, false);

lifecycleStop?.();
globalThis.WebSocket = originalWebSocket;
await new Promise((resolve) => appServer.close(resolve));
await new Promise((resolve) => targetServer.close(resolve));
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('PASS namespaced assistant ingress, event/default/missing-source routes, and GET/POST forwarding');
console.log('PASS loopback HTTP allowlist, invalid target rejection, no Authorization forwarding, and redirect rejection');
console.log('PASS dynamic App event catalog UI model, missing-catalog degradation, and no hardcoded event IDs');
console.log('PASS route config persistence/readback and explicit App endpoint activation without silent overwrite');
