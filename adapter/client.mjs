/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: Private Adapter connection state and an Android App API path/request.
 * [OUTPUT]: Authenticated text/JSON responses without exposing credentials in errors.
 * [POS]: The only direct HTTP transport from this Adapter to the Android App.
 * [PROTOCOL]: Never include the token or a credential-bearing URL in errors or logs.
 */

const headersFor = (cfg, extra = {}) => ({
  Authorization: `Bearer ${cfg.token}`,
  ...extra,
});

async function request(cfg, pathname, init = {}) {
  if (!cfg.base_url || !cfg.token) throw new Error('not_connected');
  const response = await fetch(cfg.base_url + pathname, {
    ...init,
    headers: headersFor(cfg, init.headers),
    signal: AbortSignal.timeout(init.timeout_ms ?? 5000),
  });
  if (!response.ok) {
    const error = new Error(`android_app_http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

async function requestJson(cfg, pathname, init = {}) {
  const response = await request(cfg, pathname, {
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
  });
  let body;
  try { body = await response.json(); } catch {
    throw new Error('android_app_json_invalid');
  }
  if (!body || body.ok !== true) throw new Error('android_app_response_invalid');
  return body.data ?? body;
}

export const getAppJson = (cfg, pathname) => requestJson(cfg, pathname);

export const postAppJson = (cfg, pathname, body) => requestJson(cfg, pathname, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function getCatalog(cfg) {
  const response = await request(cfg, '/api/app/apis?format=md', {
    headers: { Accept: 'text/markdown, text/plain;q=0.9' },
    timeout_ms: 8000,
  });
  const text = await response.text();
  if (!text.trim() || !text.includes('/api/app/apis')) throw new Error('android_app_catalog_invalid');
  return text;
}

export async function getAppStatus(cfg) {
  const response = await request(cfg, '/api/app/status', {
    headers: { Accept: 'application/json' },
    timeout_ms: 3000,
  });
  const body = await response.json();
  if (!body?.ok) throw new Error('android_app_status_invalid');
  return body.data ?? body;
}

export async function connectCandidate(baseUrl, token) {
  const cfg = { base_url: baseUrl, token };
  const [catalogMd, status] = await Promise.all([getCatalog(cfg), getAppStatus(cfg)]);
  return { catalogMd, status };
}
