#!/usr/bin/env node
/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: Framework URL/System Key and an active installed or Dev Package instance.
 * [OUTPUT]: Device verification for masked public state and live android.app.api descriptor.
 * [POS]: Optional target verification hook; Dev review remains distinct from an Installed Release.
 * [PROTOCOL]: Evidence must never print the App token or Authorization header.
 */

const base = process.env.TERMUX_OS_FRAMEWORK_URL ?? 'http://127.0.0.1:8980';
const systemKey = process.env.TERMUX_OS_SYSTEM_KEY ?? process.env.TERMUX_OS_TOKEN ?? '';
const packageId = process.env.TERMUX_OS_PACKAGE_ID ?? 'github.termux-os.adapter.android-app';
const headers = { Authorization: `Bearer ${systemKey}`, 'Content-Type': 'application/json' };
const checks = [];

async function check(id, fn) {
  try { checks.push({ id, result: 'pass', evidence: await fn() }); }
  catch (error) { checks.push({ id, result: 'fail', evidence: String(error?.message ?? error) }); }
}

async function json(path, init = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers,
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.detail ?? body.reason ?? body.error ?? `HTTP ${response.status}`);
  return body;
}

await check('public_connection_masked', async () => {
  const body = await json(`/api/packages/${packageId}/connection`);
  const c = body.connection;
  if (!c?.connected || !c.token_set || Object.hasOwn(c, 'token')) throw new Error('connection not live or token exposed');
  return `connected; catalog_bytes=${c.catalog_bytes}`;
});

await check('capability_descriptor_live', async () => {
  const body = await json('/api/capabilities/android.app.api');
  if (!body.ready) throw new Error(body.reason ?? 'Capability not ready');
  return `provider=${body.provider}; ready=true`;
});

await check('catalog_refresh_invoke', async () => {
  const body = await json('/api/capabilities/android.app.api/invoke', {
    method: 'POST',
    body: JSON.stringify({ input: { refresh_catalog: true } }),
  });
  const value = body.value;
  if (!value?.catalog_md || !value?.base_url || !value?.token) throw new Error('descriptor incomplete');
  return `catalog_bytes=${Buffer.byteLength(value.catalog_md, 'utf8')}`;
});

const result = checks.some((item) => item.result === 'fail') ? 'fail' : 'pass';
console.log(JSON.stringify({ schema: 'termux-os.device-verify.v1', result, checks }));
process.exit(result === 'pass' ? 0 : 1);
