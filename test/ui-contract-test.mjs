/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: Adapter tab markup, browser controller, and parameter view modules.
 * [OUTPUT]: Static checks for accessible tabs, remembered selection, ownership split, and preserved actions.
 * [POS]: Host-side UI contract test; it does not start Framework or contact an App/device.
 * [PROTOCOL]: Keep every tab linked to one panel and preserve existing action IDs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
const parameters = fs.readFileSync(path.join(root, 'web/parameters.js'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'scripts/smoke.sh'), 'utf8');
const tabs = [...html.matchAll(/<button\b([^>]*)role="tab"([^>]*)>([^<]+)<\/button>/g)]
  .map((match) => `${match[1]} ${match[2]} ${match[3]}`);
const expected = [
  ['connection', 'Connection'],
  ['parameters', 'App Parameters'],
  ['assistant-routing', 'Assistant Routing'],
  ['api-catalog', 'App API Catalog'],
  ['diagnostics', 'Diagnostics / Boundary'],
];

assert.match(html, /<nav\b[^>]*role="tablist"/, 'navigation exposes a tablist');
assert.equal(tabs.length, expected.length, 'all five product areas are tabs');
for (const [index, [name, label]] of expected.entries()) {
  const tab = tabs[index];
  assert.match(tab, new RegExp(`id="tab-${name}"`));
  assert.match(tab, new RegExp(`data-tab="${name}"`));
  assert.match(tab, new RegExp(`aria-controls="panel-${name}"`));
  assert.ok(tab.includes(label), `tab label ${label} is present`);
  assert.match(html, new RegExp(`<section id="panel-${name}"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-${name}"`),
    `${name} has a linked page panel`);
}
assert.match(html, /id="tab-connection"[^>]*aria-selected="true"[^>]*tabindex="0"/,
  'Connection is the initial tab');
assert.match(html, /id="panel-parameters"[^>]*hidden/, 'other tab panels start hidden');
assert.match(html, /id="assistant-app-parameters"[^>]*hidden/, 'App Assistant fields have a dedicated destination');
assert.match(html, /id="assistant-event-rows"/, 'Assistant event routing remains in its dedicated panel');
assert.match(html, /for="base-url">Adapter connection target \(App API URL\)/,
  'Connection labels the editable URL as the Adapter-owned target');
assert.match(html, /This changes only the Adapter target[\s\S]*App API listener/,
  'Connection explains that changing the target does not change the App listener');
for (const id of ['connection-listener', 'connection-listener-port', 'connection-target-diagnostic',
  'diag-connection-state', 'diag-target', 'diag-listener', 'diag-listener-port', 'diag-token-state',
  'diag-app-version', 'diag-schema-version', 'diag-assistant-events', 'diag-generic-fields']) {
  assert.match(html, new RegExp(`id="${id}"`), `read-only connection fact ${id} is present`);
}
const diagnostics = html.slice(html.indexOf('<section id="panel-diagnostics"'), html.indexOf('</main>'));
assert.doesNotMatch(diagnostics, /<(?:input|button|select)\b/i,
  'Diagnostics / Boundary contains no settings controls');
assert.ok(diagnostics.includes('Framework serves this Adapter page through Package dispatch'));
assert.ok(diagnostics.includes('Framework Core does not own App product workflow'));
assert.ok(diagnostics.includes('There is no Framework Core'));
assert.ok(diagnostics.includes('Adapter owns Assistant route policy'));
assert.ok(diagnostics.includes('Speech product settings stay in termux-speech'));
assert.ok(diagnostics.includes('ADAPTER_GENERIC_UI'));

for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
  assert.ok(app.includes(`'${key}'`), `tab keyboard navigation handles ${key}`);
}
assert.ok(app.includes('window.location.hash.slice(1)'), 'last selected tab is restored from the URL hash');
assert.ok(app.includes('url.hash = selected.dataset.tab'), 'tab choice is remembered in the URL hash');
assert.doesNotMatch(app, /localStorage|sessionStorage/, 'the UI does not use browser storage');
for (const actionId of ['connect', 'refresh', 'disconnect', 'assistant-routing-save', 'assistant-use-router']) {
  assert.ok(app.includes(`$('${actionId}').addEventListener`), `${actionId} action stays wired`);
}
assert.ok(app.includes('buildAssistantParameterGroups'), 'Assistant schema fields go to the dedicated routing view');
assert.ok(app.includes('buildParameterGroups'), 'generic schema fields still use the generic view');
assert.ok(app.includes('live.api_base_url'), 'the UI renders the App-reported listener address');
assert.ok(app.includes('Adapter target differs from the App-reported listener'), 'target/listener mismatch is diagnostic only');
assert.ok(app.includes('The target remains as configured'), 'a reported listener never silently overwrites the Adapter target');
assert.ok(app.includes('filtered_field_count'), 'Diagnostics reports generic schema fields filtered by ownership');
assert.ok(parameters.includes("location === GENERIC_LOCATION"), 'browser renderer checks generic UI ownership');
assert.ok(parameters.includes("field.category === 'assistant'"), 'generic renderer excludes dedicated Assistant fields');
assert.ok(smoke.includes('test/ui-contract-test.mjs'), 'smoke runner executes the UI contract checks');
console.log('PASS accessible tabs, clear target/listener diagnostics, ownership boundaries, and preserved actions');
