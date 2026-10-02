/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: Private route configuration and the authenticated assistant.primary HTTP envelope
 * [OUTPUT]: Validated loopback target selection and bounded HTTP forwarding for Assistant events
 * [POS]: Android App Adapter router; per-event policy stays outside App and Framework Core
 * [PROTOCOL]: Keep the route schema, namespaced ingress, and loopback-only target checks synchronized
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

export const ROUTING_SCHEMA = 'termux-os.android-app-adapter.assistant-routing.v1';
export const ASSISTANT_ACTION = 'assistant.primary';
export const ROUTER_PACKAGE_ID = 'github.termux-os.adapter.android-app';
export const ROUTER_INGRESS_PATH = `/api/packages/${ROUTER_PACKAGE_ID}/assistant/call`;
export const ROUTER_TIMEOUT_MS = 5000;

const SOURCE_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const defaults = () => ({ schema: ROUTING_SCHEMA, default_endpoint: '', event_routes: {} });
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function isLoopbackHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === 'ip6-localhost' || host === '::1') return true;
  if (net.isIP(host) !== 4) return false;
  return Number(host.split('.')[0]) === 127;
}

export function normalizeAssistantEndpoint(value) {
  if (typeof value !== 'string') throw Object.assign(new Error('assistant_endpoint_invalid'), { status: 400 });
  const raw = value.trim();
  if (!raw) return '';
  if (raw.length > 2048) throw Object.assign(new Error('assistant_endpoint_invalid'), { status: 400 });
  let url;
  try { url = new URL(raw); } catch {
    throw Object.assign(new Error('assistant_endpoint_invalid'), { status: 400 });
  }
  if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)
      || url.username || url.password || url.search || url.hash || raw.includes('?') || raw.includes('#')) {
    throw Object.assign(new Error('assistant_endpoint_invalid'), { status: 400 });
  }
  return url.href;
}

export function normalizeAssistantRouting(value) {
  if (!isRecord(value)) throw Object.assign(new Error('assistant_routing_invalid'), { status: 400 });
  const eventRoutes = {};
  const incoming = value.event_routes ?? {};
  if (!isRecord(incoming)) throw Object.assign(new Error('assistant_event_routes_invalid'), { status: 400 });
  for (const [source, endpoint] of Object.entries(incoming)) {
    if (!SOURCE_ID.test(source)) throw Object.assign(new Error('assistant_source_invalid'), { status: 400 });
    eventRoutes[source] = normalizeAssistantEndpoint(endpoint);
  }
  return {
    schema: ROUTING_SCHEMA,
    default_endpoint: normalizeAssistantEndpoint(value.default_endpoint ?? ''),
    event_routes: eventRoutes,
  };
}

export function loadAssistantRouting(file) {
  if (!fs.existsSync(file)) return defaults();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (saved?.schema !== ROUTING_SCHEMA) {
    throw Object.assign(new Error('assistant_routing_schema_invalid'), { status: 500 });
  }
  const routing = normalizeAssistantRouting(saved);
  try { fs.chmodSync(file, 0o600); } catch { /* Best effort on Android filesystems. */ }
  return routing;
}

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Best effort on Android filesystems. */ }
}

export function saveAssistantRouting(file, value) {
  const routing = normalizeAssistantRouting(value);
  writePrivate(file, routing);
  return loadAssistantRouting(file);
}

export function selectAssistantRoute(routing, source) {
  const eventEndpoint = typeof source === 'string' ? routing.event_routes[source]?.trim() : '';
  if (eventEndpoint) return { endpoint: eventEndpoint, kind: 'event' };
  if (routing.default_endpoint) return { endpoint: routing.default_endpoint, kind: 'default' };
  return { endpoint: '', kind: 'none' };
}

function header(headers, name) {
  const key = name.toLowerCase();
  const entry = Object.entries(headers ?? {}).find(([candidate]) => candidate.toLowerCase() === key);
  return entry ? String(entry[1] ?? '').trim() : '';
}

export async function dispatchAssistantCall({ routing, method, headers = {}, body = null }) {
  const requestMethod = String(method ?? '').toUpperCase();
  if (!['GET', 'POST'].includes(requestMethod)) {
    return { status: 405, payload: { ok: false, error: 'assistant_method_not_allowed' } };
  }
  const actionHeader = header(headers, 'X-Termux-OS-Assistant-Action');
  if (actionHeader && actionHeader !== ASSISTANT_ACTION) {
    return { status: 400, payload: { ok: false, error: 'assistant_action_invalid' } };
  }
  if (requestMethod === 'POST' && !isRecord(body)) {
    return { status: 400, payload: { ok: false, error: 'assistant_request_invalid' } };
  }
  if (isRecord(body) && body.action_id !== undefined && body.action_id !== ASSISTANT_ACTION) {
    return { status: 400, payload: { ok: false, error: 'assistant_action_invalid' } };
  }

  const rawSource = header(headers, 'X-Termux-OS-Assistant-Source');
  const source = SOURCE_ID.test(rawSource) ? rawSource : '';
  const selected = selectAssistantRoute(routing, source);
  if (!selected.endpoint) {
    return {
      status: 409,
      payload: { ok: false, error: 'assistant_route_not_configured', fallback: 'none' },
    };
  }

  let target;
  try { target = new URL(normalizeAssistantEndpoint(selected.endpoint)); } catch {
    return { status: 502, payload: { ok: false, error: 'assistant_route_target_invalid' } };
  }
  const requestHeaders = {
    Accept: 'application/json',
    'X-Termux-OS-Assistant-Action': ASSISTANT_ACTION,
  };
  if (source) requestHeaders['X-Termux-OS-Assistant-Source'] = source;
  if (requestMethod === 'POST') requestHeaders['Content-Type'] = 'application/json';

  try {
    const response = await fetch(target, {
      method: requestMethod,
      headers: requestHeaders,
      ...(requestMethod === 'POST' ? { body: JSON.stringify({ action_id: ASSISTANT_ACTION }) } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      return { status: 502, payload: { ok: false, error: 'assistant_redirect_rejected' } };
    }
    await response.body?.cancel().catch(() => {});
    if (!response.ok) {
      return { status: 502, payload: { ok: false, error: 'assistant_target_failed', upstream_status: response.status } };
    }
    return {
      status: 200,
      payload: { ok: true, action_id: ASSISTANT_ACTION, route: selected.kind },
    };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      status: timedOut ? 504 : 502,
      payload: { ok: false, error: timedOut ? 'assistant_target_timeout' : 'assistant_target_unavailable' },
    };
  }
}

export function routerIngressUrl(localPort) {
  const port = Number(localPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('assistant_router_port_unavailable'), { status: 500 });
  }
  return `http://127.0.0.1:${port}${ROUTER_INGRESS_PATH}`;
}
