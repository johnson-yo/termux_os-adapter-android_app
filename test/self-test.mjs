/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: Isolated temporary files and a local authenticated Android App fixture.
 * [OUTPUT]: PASS/FAIL evidence for URL validation, authentication, masking, persistence, and Capability descriptor shape.
 * [POS]: Fast package-level contract test; it never contacts a real phone App.
 * [PROTOCOL]: Fixture credentials are process-local test values and never enter Package defaults.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  clearConnection, loadConfig, normalizeBaseUrl, publicConfig, saveConnected,
} from '../adapter/config.mjs';
import { connectCandidate } from '../adapter/client.mjs';
import { makeActions } from '../adapter/actions.mjs';
import { probe } from '../adapter/probe.mjs';
import {
  RECONNECT_BASE_MS, RECONNECT_MAX_MS, outputRouteClass, routeDeviceFrom, speakingFrom,
} from '../adapter/speech-states.mjs';

let failures = 0;
const test = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
  if (!condition) failures += 1;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'android-app-adapter-'));
const configFile = path.join(tmp, 'connection.json');
const fixtureToken = 'fixture-provider-secret';
const catalog = '# Fixture App APIs\n\nGET /api/app/apis?format=md\n';

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${fixtureToken}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"ok":false,"error":"unauthorized"}');
    return;
  }
  if (req.url === '/api/app/apis?format=md') {
    res.writeHead(200, { 'Content-Type': 'text/markdown' });
    res.end(catalog);
    return;
  }
  if (req.url === '/api/app/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true,"data":{"package":"fixture","version":"1.0","api_port":9123,"api_base_url":"http://127.0.0.1:9123"}}');
    return;
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test('default connection has no credential', loadConfig(configFile).token === '');
test('base URL is normalized to an origin', normalizeBaseUrl(baseUrl + '/') === baseUrl);
test('base URL path is rejected', (() => {
  try { normalizeBaseUrl(baseUrl + '/api'); return false; } catch { return true; }
})());

let rejected = false;
try { await connectCandidate(baseUrl, 'wrong'); } catch { rejected = true; }
test('wrong provider token is rejected', rejected);

const connected = await connectCandidate(baseUrl, fixtureToken);
test('authenticated catalog is fetched', connected.catalogMd === catalog);
const cfg = saveConnected(configFile, {
  baseUrl,
  token: fixtureToken,
  catalogMd: connected.catalogMd,
});
test('private config is owner-only', (fs.statSync(configFile).mode & 0o077) === 0);

const live = await probe(cfg);
const pub = publicConfig(cfg, { live });
test('public state reports live connection and App-reported listener', pub.connected === true && pub.catalog_md === catalog && pub.live.api_base_url === 'http://127.0.0.1:9123' && pub.live.api_port === 9123);
test('public state masks credential', !JSON.stringify(pub).includes(fixtureToken) && pub.token_set === true);

const action = makeActions(configFile)[0];
const descriptor = await action.run({});
test('Capability descriptor supplies base URL/token/catalog to trusted consumers',
  descriptor.base_url === baseUrl
  && descriptor.token === fixtureToken
  && descriptor.catalog_md === catalog
  && descriptor.headers.Authorization === `Bearer ${fixtureToken}`);

const cleared = clearConnection(configFile);
test('disconnect removes credential and catalog', !cleared.token && !cleared.catalog_md);

// ---- docs/056: the state readers, pinned to a real device response ----------------------------
//
// This fixture is a byte-for-byte capture of `GET /api/android/tts/playback` from zflip5 on
// 2026-07-31 (data envelope unwrapped). It is NOT hand-written: the previous readers looked for
// `speaking` / `routed_output_device`, names the App has never emitted, so `speech.tts` was pinned
// to false and `audio.output.route` to unknown for the whole life of the feature — silently,
// because a missing field reads as `undefined` and `undefined === true` is just `false`.
const APP_PLAYBACK_IDLE = {
  playback_id: null, phase: 'idle', active: false, engine: null, language: null, voice: null,
  output_selector: null, preferred_device: null, routed_device: null, route_matched: null,
  sample_rate: 0, channels: 0, pcm_bytes: 0, underrun_count: 0,
  started_at_ms: null, updated_at_ms: 1785406963197, error: null,
};
const APP_PLAYBACK_SPEAKING = {
  ...APP_PLAYBACK_IDLE,
  playback_id: 'utt-1', phase: 'playing', active: true,
  routed_device: { id: 3, type_name: 'builtin_speaker', product_name: 'speaker' },
  started_at_ms: 1785406963000,
};

test('idle playback is not speaking', speakingFrom(APP_PLAYBACK_IDLE) === false);
test('active playback is speaking', speakingFrom(APP_PLAYBACK_SPEAKING) === true);
test('the App field is `active`, not `speaking`/`playing`/`state`',
  speakingFrom({ speaking: true }) === false && speakingFrom({ active: true }) === true);
test('routed device wins over preferred', routeDeviceFrom({
  routed_device: { type_name: 'wired_headset' }, preferred_device: { type_name: 'builtin_speaker' },
})?.type_name === 'wired_headset');
test('preferred device is the fallback',
  routeDeviceFrom({ preferred_device: { type_name: 'builtin_speaker' } })?.type_name === 'builtin_speaker');
test('speaking playback classifies as built_in, not unknown',
  outputRouteClass(routeDeviceFrom(APP_PLAYBACK_SPEAKING)) === 'built_in');
test('an absent device is unknown, which is in-band',
  outputRouteClass(routeDeviceFrom(APP_PLAYBACK_IDLE)) === 'unknown');
test('the old field names would have produced the silent failure',
  outputRouteClass(APP_PLAYBACK_SPEAKING.routed_output_device) === 'unknown');
test('reconnect backoff is bounded', RECONNECT_MAX_MS >= RECONNECT_BASE_MS && RECONNECT_MAX_MS <= 60_000);

await new Promise((resolve) => server.close(resolve));
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
