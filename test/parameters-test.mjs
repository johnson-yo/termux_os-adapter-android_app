/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: Mock App schema/config endpoints and isolated Adapter requests.
 * [OUTPUT]: Host evidence for schema parsing, generated controls, safe fallback, and write/readback.
 * [POS]: Focused R3 test; it never contacts a real device or persists credentials.
 * [PROTOCOL]: Keep test-only secrets in process memory and assert none reach WebUI data.
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
  loadParameters, parseSchema, writeParameter,
} from '../adapter/parameters.mjs';
const browserModuleSource = fs.readFileSync(
  fileURLToPath(new URL('../web/parameters.js', import.meta.url)), 'utf8');
const { buildParameterGroups, saveField } = await import(
  `data:text/javascript;base64,${Buffer.from(browserModuleSource).toString('base64')}`);

const secret = 'fixture-secret-value';
const values = { enabled: false, threshold: 1.25, label: 'Before', locked: 'managed', ime_allow_password: false };
const gate = { mode: 'volume', tolerance: 'standard' };
const ime = { enabled: true, port: 8797, bind: '0.0.0.0' };
let schemaMode = 'current';
let failLabelWrite = false;
const field = (key, type, value, readEndpoint, writeEndpoint, extra = {}) => ({
  key,
  type,
  default: value,
  editable: true,
  category: 'custom',
  description: `Description for ${key}`,
  validation: { kind: 'none' },
  read_endpoint: readEndpoint,
  write_endpoint: writeEndpoint,
  ui_hint: type === 'boolean' ? 'toggle' : type === 'enum' ? 'select' : type === 'number' ? 'number' : 'text',
  ...extra,
});
const schema = {
  schema: 'termux-os.app-config-schema.v1',
  schema_version: '1.0.0',
  read_only: true,
  entries: [
    field('enabled', 'boolean', false, 'GET /api/app/config', 'POST /api/app/config'),
    {
      ...field('mode', 'enum', 'volume', 'GET /api/audio/gate/state', 'POST /api/audio/gate/config'),
      validation: { kind: 'enum', values: ['volume', 'feature'] },
      read_field: 'mode', write_field: 'mode',
    },
    field('threshold', 'number', 1.25, 'GET /api/app/config', 'POST /api/app/config'),
    field('label', 'string', 'Before', 'GET /api/app/config', 'POST /api/app/config'),
    field('ime_allow_password', 'boolean', false, 'GET /api/app/config', 'POST /api/app/config'),
    {
      ...field('locked', 'string', 'managed', 'GET /api/app/config', ''),
      editable: false,
    },
    {
      ...field('future_string', 'string', 'future', 'GET /api/app/config', 'POST /api/app/config'),
      category: 'future-category', ui_hint: 'unrecognized-widget',
    },
    {
      ...field('ime_bind_lan', 'boolean', false, 'GET /api/ime/status', 'POST /api/ime/config'),
      read_field: 'bind', write_field: 'ime_bind_lan',
      read_transform: 'true when bind is 0.0.0.0',
    },
    field('token_for_test', 'string', secret, 'GET /api/app/config', 'POST /api/app/config'),
    field('admin_password', 'string', secret, 'GET /api/app/config', 'POST /api/app/config'),
    {
      ...field('unsupported_write', 'string', 'safe', 'GET /api/app/config', 'POST /api/custom/config'),
    },
    {
      ...field('bad_number', 'number', 'wrong', 'GET /api/app/config', 'POST /api/app/config'),
    },
  ],
};

const server = http.createServer(async (req, res) => {
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== 'Bearer fixture-token') return json(401, { ok: false });
  if (req.url === '/api/app/config/schema' && req.method === 'GET') {
    if (schemaMode === 'missing') return json(404, { ok: false, error: 'not_found' });
    if (schemaMode === 'malformed') return json(200, { ok: true, data: { schema_version: '1.0.0', entries: 'broken' } });
    if (schemaMode === 'unsupported') return json(200, { ok: true, data: { ...schema, schema_version: '2.0.0' } });
    return json(200, { ok: true, data: schema });
  }
  if (req.url === '/api/app/config' && req.method === 'GET') {
    return json(200, { ok: true, data: { ...values, token_for_test: secret } });
  }
  if (req.url === '/api/audio/gate/state' && req.method === 'GET') {
    return json(200, { ok: true, data: gate });
  }
  if (req.url === '/api/ime/status' && req.method === 'GET') {
    return json(200, { ok: true, data: ime });
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (req.url === '/api/app/config' && req.method === 'POST') {
    if (body.label === 'fail' && failLabelWrite) return json(400, { ok: false, error: 'invalid' });
    Object.assign(values, body);
    return json(200, { ok: true, data: { ...values, token_for_test: secret } });
  }
  if (req.url === '/api/audio/gate/config' && req.method === 'POST') {
    Object.assign(gate, body);
    return json(200, { ok: true, data: gate });
  }
  if (req.url === '/api/ime/config' && req.method === 'POST') {
    if (Object.hasOwn(body, 'ime_bind_lan')) ime.bind = body.ime_bind_lan ? '0.0.0.0' : '127.0.0.1';
    return json(200, { ok: true, data: ime });
  }
  return json(404, { ok: false, error: 'not_found' });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const cfg = { base_url: `http://127.0.0.1:${server.address().port}`, token: 'fixture-token' };

const loaded = await loadParameters(cfg);
assert.equal(loaded.available, true, 'schema 1.0.0 loads');
assert.equal(loaded.schema_version, '1.0.0');
assert.equal(loaded.fields.some((item) => item.key === 'token_for_test'), false, 'secret/token key is filtered');
assert.equal(loaded.fields.some((item) => item.key === 'admin_password'), false, 'password credential is filtered');
assert.equal(loaded.fields.some((item) => item.key === 'ime_allow_password'), true, 'boolean policy toggle is not a credential');
assert.equal(JSON.stringify(loaded).includes(secret), false, 'secret value never reaches WebUI payload');
assert.equal(loaded.field_errors.length, 1, 'one malformed entry is isolated');
assert.equal(loaded.unsupported_fields.some((item) => item.key === 'unsupported_write'), true);
assert.equal(loaded.fields.find((item) => item.key === 'enabled').value, false);
assert.equal(loaded.fields.find((item) => item.key === 'mode').value, 'volume');
assert.equal(loaded.fields.find((item) => item.key === 'ime_bind_lan').value, true, 'read transform uses schema expression');

const groups = buildParameterGroups(loaded);
const uiFields = groups.flatMap((group) => group.fields);
assert.equal(uiFields.find((item) => item.key === 'enabled').control, 'checkbox');
assert.equal(uiFields.find((item) => item.key === 'mode').control, 'select');
assert.equal(uiFields.find((item) => item.key === 'threshold').control, 'number');
assert.equal(uiFields.find((item) => item.key === 'label').control, 'text');
assert.equal(uiFields.find((item) => item.key === 'future_string').control, 'text', 'unknown UI hint falls back by type');
assert.equal(uiFields.find((item) => item.key === 'future_string').category, 'Other', 'unknown category is grouped as Other');
assert.equal(uiFields.find((item) => item.key === 'locked').writable, false, 'editable=false is read-only');
assert.equal(uiFields.find((item) => item.key === 'unsupported_write').writable, false, 'unsupported writer is read-only');
assert.equal(uiFields.some((item) => item.key === 'token_for_test'), false, 'token field is not rendered');
assert.equal(uiFields.some((item) => item.key === 'admin_password'), false, 'password credential is not rendered');

const saved = await writeParameter(cfg, 'enabled', true);
assert.equal(values.enabled, true);
assert.equal(saved.value, true);
assert.equal(saved.readback_matches, true, 'save is verified through the declared read endpoint');
const gateSaved = await writeParameter(cfg, 'mode', 'feature');
assert.equal(gate.mode, 'feature');
assert.equal(gateSaved.value, 'feature', 'non-default endpoint is used and read back');
const imeSaved = await writeParameter(cfg, 'ime_bind_lan', false);
assert.equal(ime.bind, '127.0.0.1');
assert.equal(imeSaved.value, false);
await assert.rejects(writeParameter(cfg, 'mode', 'invalid'), /parameter_value_invalid/);
await assert.rejects(writeParameter(cfg, 'token_for_test', secret), /parameter_not_allowlisted/);
await assert.rejects(writeParameter(cfg, 'unsupported_write', 'changed'), /unsupported_write_endpoint/);

schemaMode = 'missing';
assert.equal((await loadParameters(cfg)).reason, 'schema_missing', 'old App 404 fallback is safe');
schemaMode = 'malformed';
assert.equal((await loadParameters(cfg)).reason, 'schema_malformed', 'malformed whole schema disables only the generic panel');
schemaMode = 'unsupported';
assert.equal((await loadParameters(cfg)).reason, 'schema_version_unsupported');
schemaMode = 'current';

const writeField = uiFields.find((item) => item.key === 'label');
const isolatedFailure = await saveField(async () => { throw new Error('mock field failure'); }, writeField, 'fail');
assert.equal(isolatedFailure.ok, false, 'one field failure is returned locally');
const isolatedSuccess = await saveField(async () => ({
  ok: true, field: { key: 'label', value: 'After', readback_matches: true },
}), writeField, 'After');
assert.equal(isolatedSuccess.ok, true, 'other field saves continue after an error');
assert.equal(isolatedSuccess.value, 'After');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-app-adapter-r3-'));
const configFile = path.join(tempDir, 'connection.json');
saveConnected(configFile, { baseUrl: cfg.base_url, token: cfg.token, catalogMd: '# mock catalog' });
const routes = new Map();
let lifecycleStop = null;
const originalWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class MockWebSocket { close() {} };
await register({
  configFile: () => configFile,
  actions: { register() {} },
  lifecycle: { register(stop) { lifecycleStop = stop; } },
  capabilities: { provide() {} },
  routes: { register(method, route, handler) { routes.set(`${method} ${route}`, handler); } },
  states: { set() {} },
});
const invoke = async (route, body = undefined) => {
  let reply;
  await routes.get(route)({}, {}, {
    json(_res, status, payload) { reply = { status, payload }; },
    async readBody() { return body; },
  });
  return reply;
};
assert.equal(routes.has('GET /connection'), true, 'existing connection UI route remains registered');
assert.equal(routes.has('POST /connection/refresh'), true, 'existing catalog refresh remains registered');
assert.equal(routes.has('DELETE /connection'), true, 'existing disconnect remains registered');
const routeLoad = await invoke('GET /parameters');
assert.equal(routeLoad.status, 200);
assert.equal(routeLoad.payload.parameters.available, true, 'package route returns sanitized App parameters');
assert.equal(JSON.stringify(routeLoad.payload).includes(secret), false, 'package route never returns token data');
const routeWrite = await invoke('POST /parameters/write', { key: 'threshold', value: 2.5 });
assert.equal(routeWrite.status, 200);
assert.equal(routeWrite.payload.field.value, 2.5, 'package route returns readback, not App POST response');
schemaMode = 'missing';
const oldRoute = await invoke('GET /parameters');
assert.equal(oldRoute.payload.parameters.reason, 'schema_missing');
schemaMode = 'current';
failLabelWrite = true;
const failedRouteWrite = await invoke('POST /parameters/write', { key: 'label', value: 'fail' });
assert.equal(failedRouteWrite.status, 400, 'one App field write failure is isolated to its route call');
failLabelWrite = false;
lifecycleStop?.();
globalThis.WebSocket = originalWebSocket;
fs.rmSync(tempDir, { recursive: true, force: true });

const malformedFieldSchema = parseSchema({
  schema_version: '1.0.0', entries: [{ key: 'ok', type: 'string', default: '', editable: true,
    category: 'webview', description: '', validation: {}, read_endpoint: 'GET /api/app/config',
    write_endpoint: 'POST /api/app/config' }, null],
});
assert.equal(malformedFieldSchema.fields.length, 1);
assert.equal(malformedFieldSchema.field_errors.length, 1, 'one bad field does not disable a valid schema');

await new Promise((resolve) => server.close(resolve));
console.log('PASS schema 1.0.0 loads and field errors are isolated');
console.log('PASS boolean/enum/number/string controls, category fallback, and unknown hint fallback');
console.log('PASS read-only, secret filtering, and unsupported write degradation');
console.log('PASS old App 404 and malformed/unsupported schema fallback');
console.log('PASS App writes use declared endpoints and read back actual values');
console.log('PASS field-level write failures do not block other fields');
console.log('PASS package routes preserve the existing connection UI and proxy only schema fields');
