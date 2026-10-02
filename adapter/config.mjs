/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: A Package-private configuration path and user-supplied Android App base URL/token.
 * [OUTPUT]: Normalized private connection state, masked public state, and atomic save/clear helpers.
 * [POS]: The Android App Adapter's only credential persistence boundary.
 * [PROTOCOL]: Never log or return the saved token from a public Package route.
 */

import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = 'termux-os.android-app-adapter.connection.v1';
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8796';

const defaults = () => ({
  schema: SCHEMA,
  base_url: DEFAULT_BASE_URL,
  token: '',
  catalog_md: '',
  connected_at: null,
  refreshed_at: null,
});

export function normalizeBaseUrl(value) {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('base_url_required');
  let url;
  try { url = new URL(raw); } catch { throw new Error('base_url_invalid'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('base_url_protocol');
  if (url.username || url.password || url.search || url.hash) throw new Error('base_url_must_be_origin');
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname && pathname !== '/') throw new Error('base_url_must_be_origin');
  return url.origin;
}

export function loadConfig(file) {
  if (!fs.existsSync(file)) return defaults();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = { ...defaults(), ...saved, schema: SCHEMA };
  cfg.base_url = normalizeBaseUrl(cfg.base_url || DEFAULT_BASE_URL);
  cfg.token = typeof cfg.token === 'string' ? cfg.token : '';
  cfg.catalog_md = typeof cfg.catalog_md === 'string' ? cfg.catalog_md : '';
  try { fs.chmodSync(file, 0o600); } catch { /* Best effort on Android filesystems. */ }
  return cfg;
}

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Best effort on Android filesystems. */ }
}

export function saveConnected(file, { baseUrl, token, catalogMd, now = new Date().toISOString() }) {
  const cleanToken = String(token ?? '').trim();
  if (!cleanToken) throw new Error('token_required');
  const cfg = {
    schema: SCHEMA,
    base_url: normalizeBaseUrl(baseUrl),
    token: cleanToken,
    catalog_md: String(catalogMd ?? ''),
    connected_at: now,
    refreshed_at: now,
  };
  writePrivate(file, cfg);
  return cfg;
}

export function saveCatalog(file, catalogMd, now = new Date().toISOString()) {
  const cfg = loadConfig(file);
  if (!cfg.token) throw new Error('not_connected');
  cfg.catalog_md = String(catalogMd ?? '');
  cfg.refreshed_at = now;
  writePrivate(file, cfg);
  return cfg;
}

export function clearConnection(file) {
  writePrivate(file, defaults());
  return loadConfig(file);
}

export function publicConfig(cfg, { live = null } = {}) {
  const connected = Boolean(cfg.token && cfg.catalog_md && live?.ok);
  return {
    schema: SCHEMA,
    base_url: cfg.base_url,
    token_set: Boolean(cfg.token),
    connected,
    connected_at: cfg.connected_at,
    refreshed_at: cfg.refreshed_at,
    catalog_md: connected ? cfg.catalog_md : '',
    catalog_bytes: connected ? Buffer.byteLength(cfg.catalog_md, 'utf8') : 0,
    live: live ?? { ok: false, reason: cfg.token ? 'not_checked' : 'not_configured' },
  };
}
