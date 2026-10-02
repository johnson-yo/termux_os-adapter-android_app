/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: Framework Browser Session routes, App event metadata, and sanitized Adapter state.
 * [OUTPUT]: Five tabbed views with distinct Adapter target/App listener facts, schema counts, and read-only ownership diagnostics.
 * [POS]: Browser-only controller; App credentials and router policy remain in the Package backend.
 * [PROTOCOL]: Never store credentials or render untrusted schema strings as HTML.
 */

import {
  buildAssistantParameterGroups, buildParameterGroups, formatValue, saveField, validationSummary,
} from './parameters.js';
import { buildAssistantEventRows, normalizeEventCatalog } from './assistant-routing.js';

const $ = (id) => document.getElementById(id);
const pathPackageId = decodeURIComponent(location.pathname.split('/')[2] ?? '');
const activePackageId = /^[\w.@-]+$/.test(pathPackageId)
  ? pathPackageId : 'github.termux-os.adapter.android-app';
const apiRoot = '/api/packages/' + activePackageId;
const api = (path, options = {}) => window.TermuxOS.api(apiRoot + path, options);
let parameterLoadGeneration = 0;
let assistantRoutingState = null;
let connectionState = null;
let parameterFacts = null;
let assistantEventCount = null;

function setParameterStatus(message, tone = 'idle', count = null) {
  $('parameters-message').textContent = message;
  $('parameters-count').className = 'pill ' + tone;
  if (count !== null) $('parameters-count').textContent = count;
}

function clearParameters() {
  parameterLoadGeneration += 1;
  $('parameters-card').hidden = true;
  $('parameters-groups').replaceChildren();
  $('assistant-app-parameters').hidden = true;
  $('assistant-parameters-groups').replaceChildren();
  $('parameters-meta').textContent = '从 App Schema 读取可编辑参数。';
  setParameterStatus('', 'idle');
  parameterFacts = null;
  updateDiagnostics();
}

function sameOrigin(left, right) {
  try { return new URL(left).origin === new URL(right).origin; } catch { return false; }
}

function updateDiagnostics() {
  const connection = connectionState ?? {};
  const connected = connection.connected === true;
  const target = typeof connection.base_url === 'string' && connection.base_url
    ? connection.base_url : 'Not configured';
  const live = connection.live ?? {};
  const listener = typeof live.api_base_url === 'string' && live.api_base_url
    ? live.api_base_url : 'Not reported';
  const listenerPort = Number.isInteger(live.api_port) ? String(live.api_port) : 'Not reported';

  $('connection-listener').textContent = connected ? listener : 'Not connected';
  $('connection-listener-port').textContent = connected ? listenerPort : 'Not reported';
  const targetDiagnostic = $('connection-target-diagnostic');
  targetDiagnostic.className = 'message';
  if (!connected) {
    targetDiagnostic.textContent = 'Disconnected. The saved Adapter target is not currently verified.';
  } else if (listener === 'Not reported') {
    targetDiagnostic.textContent = 'The connected App did not report api_base_url; the Adapter target is unchanged.';
  } else if (sameOrigin(connection.base_url, listener)) {
    targetDiagnostic.textContent = 'Adapter target matches the App-reported listener.';
  } else {
    targetDiagnostic.className = 'message parameter-warning';
    targetDiagnostic.textContent = 'Adapter target differs from the App-reported listener. The target remains as configured; change the listener in App Settings if needed.';
  }

  $('diag-connection-state').textContent = connected ? 'Connected' : (connection.token_set ? 'App unreachable' : 'Disconnected');
  $('diag-target').textContent = target;
  $('diag-listener').textContent = connected ? listener : 'Not connected';
  $('diag-listener-port').textContent = connected ? listenerPort : 'Not reported';
  $('diag-token-state').textContent = connection.token_set ? 'Set (value hidden)' : 'Not set';
  $('diag-app-version').textContent = connected ? (live.version ?? 'Not reported') : 'Not connected';
  $('diag-schema-version').textContent = connected
    ? (parameterFacts?.schemaVersion ?? 'Not available') : 'Not connected';
  $('diag-assistant-events').textContent = connected && assistantEventCount !== null
    ? String(assistantEventCount) : (connected ? 'Not available' : 'Not connected');
  $('diag-generic-fields').textContent = connected && parameterFacts?.available
    ? `${parameterFacts.rendered} rendered · ${parameterFacts.filtered} filtered · ${parameterFacts.invalid} invalid`
    : (connected ? 'Not available' : 'Not connected');
}

function activateTab(name, focus = false, persist = true) {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const selected = tabs.find((tab) => tab.dataset.tab === name) ?? tabs[0];
  if (!selected) return;
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    if (panel) panel.hidden = !active;
  }
  if (focus) selected.focus();
  if (persist) {
    const url = new URL(window.location.href);
    url.hash = selected.dataset.tab;
    window.history.replaceState(null, '', url);
  }
}

function setupTabs() {
  const tablist = document.querySelector('[role="tablist"]');
  if (!tablist) return;
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab && tablist.contains(tab)) activateTab(tab.dataset.tab);
  });
  tablist.addEventListener('keydown', (event) => {
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    let next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    activateTab(tabs[next].dataset.tab, true);
  });
  const lastTab = window.location.hash.slice(1) || 'connection';
  activateTab(lastTab, false, false);
}

function render(connection) {
  connectionState = connection;
  const connected = connection?.connected === true;
  if (!connected) {
    parameterFacts = null;
    assistantEventCount = null;
  }
  $('state').textContent = connected ? '已连接' : '未连接';
  $('state').className = 'pill ' + (connected ? 'ok' : 'idle');
  $('diagnostics-state').textContent = connected ? 'App API 可达' : (connection?.token_set ? 'App API 不可达' : '未连接');
  $('diagnostics-state').className = 'pill ' + (connected ? 'ok' : 'idle');
  $('diagnostics-detail').textContent = connected
    ? `已认证 API Markdown · ${connection.catalog_bytes} bytes · ${connection.refreshed_at ?? '刚刚刷新'}`
    : (connection?.live?.reason ? `最近连接检查：${connection.live.reason}` : '连接状态与 App API 目录只读。');
  $('refresh').disabled = !connected;
  $('disconnect').disabled = !connection?.token_set;
  if (!$('base-url').value) $('base-url').value = connection?.base_url ?? 'http://127.0.0.1:8796';

  $('catalog-card').hidden = !connected;
  $('assistant-routing-card').hidden = !connected;
  $('catalog').textContent = connected ? connection.catalog_md : '';
  $('catalog-meta').textContent = connected
    ? `${connection.catalog_bytes} bytes · ${connection.refreshed_at ?? '刚刚刷新'}`
    : '';
  if (!connected) clearParameters();
  if (!connected) assistantRoutingState = null;
  updateDiagnostics();
  if (!connected && connection?.live?.reason && connection.live.reason !== 'not_configured') {
    $('message').textContent = `连接不可用：${connection.live.reason}`;
  }
}

function renderAssistantRouting(state) {
  assistantRoutingState = state;
  $('assistant-router-ingress').textContent = state.router_ingress_url;
  $('assistant-default-endpoint').value = state.routing?.default_endpoint ?? '';
  const catalog = normalizeEventCatalog(state.event_catalog);
  assistantEventCount = catalog.available ? catalog.events.length : null;
  updateDiagnostics();
  const eventRows = $('assistant-event-rows');
  eventRows.replaceChildren();
  if (!catalog.available) {
    $('assistant-catalog-warning').hidden = false;
    $('assistant-catalog-warning').textContent = 'App 事件目录暂不可用；默认路由仍可配置，已保存的事件路由会保留。';
  } else {
    $('assistant-catalog-warning').hidden = true;
    for (const event of buildAssistantEventRows(catalog, state.routing?.event_routes)) {
      const row = document.createElement('article');
      row.className = 'assistant-event-row';
      const heading = document.createElement('div');
      heading.className = 'assistant-event-heading';
      appendText(heading, 'h3', '', event.label);
      appendText(heading, 'code', 'assistant-event-name', event.name);
      appendText(heading, 'span', 'pill idle', event.system_origin ? '系统来源' : '应用来源');
      row.append(heading);
      appendText(row, 'p', 'parameter-description', event.description);
      const label = document.createElement('label');
      label.textContent = 'Event endpoint';
      const input = document.createElement('input');
      input.type = 'url';
      input.inputMode = 'url';
      input.autocomplete = 'off';
      input.value = event.endpoint;
      input.placeholder = '留空以使用 Default assistant endpoint';
      input.dataset.eventRoute = event.name;
      input.setAttribute('aria-label', `${event.name} endpoint`);
      label.append(input);
      row.append(label);
      eventRows.append(row);
    }
  }

  const current = state.app_endpoint ?? {};
  if (current.matches_router) {
    $('assistant-current-endpoint').textContent = 'App assistant_primary_endpoint 已指向 Adapter Router。';
  } else if (current.configured && current.hidden) {
    $('assistant-current-endpoint').textContent = 'App 已配置其他 endpoint；该值因不符合安全格式而隐藏。';
  } else if (current.configured && current.value) {
    $('assistant-current-endpoint').textContent = `当前 App endpoint：${current.value}`;
  } else if (current.reason) {
    $('assistant-current-endpoint').textContent = '暂时无法读取 App assistant_primary_endpoint。';
  } else {
    $('assistant-current-endpoint').textContent = 'App 未设置 shared endpoint，当前沿用既有 /assistant/call fallback。';
  }
  $('assistant-use-router').disabled = current.matches_router === true || Boolean(current.reason);
  $('assistant-routing-message').textContent = catalog.available
    ? `${catalog.events.length} 个事件来自 App 实际事件目录。目标仅接受 loopback 明文 HTTP。`
    : '事件明细不可用时，其他 Adapter 功能与默认路由仍可继续使用。';
}

async function loadAssistantRouting() {
  if (!assistantRoutingState && $('assistant-routing-card').hidden) return;
  try {
    renderAssistantRouting(await request('/assistant/routing'));
  } catch (error) {
    assistantRoutingState = null;
    assistantEventCount = null;
    updateDiagnostics();
    $('assistant-router-ingress').textContent = '暂不可用';
    $('assistant-event-rows').replaceChildren();
    $('assistant-catalog-warning').hidden = false;
    $('assistant-catalog-warning').textContent = `Assistant 路由设置暂不可用：${String(error?.message ?? error)}`;
    $('assistant-routing-message').textContent = '连接与 API 目录仍可继续使用。';
    $('assistant-use-router').disabled = true;
  }
}

async function saveAssistantRouting() {
  const routes = { ...(assistantRoutingState?.routing?.event_routes ?? {}) };
  for (const input of $('assistant-event-rows').querySelectorAll('[data-event-route]')) {
    routes[input.dataset.eventRoute] = input.value;
  }
  await request('/assistant/routing', {
    method: 'POST',
    body: JSON.stringify({
      default_endpoint: $('assistant-default-endpoint').value,
      event_routes: routes,
    }),
  });
  await loadAssistantRouting();
  $('assistant-routing-message').textContent = '路由已保存并读取回确认。';
}

async function useAssistantRouter() {
  const current = assistantRoutingState?.app_endpoint ?? {};
  let replaceExisting = false;
  if (current.configured && !current.matches_router) {
    const description = current.hidden ? '一个已隐藏的 endpoint' : current.value;
    if (!window.confirm(`将把 App 的 assistant_primary_endpoint 从 ${description || '现有配置'} 改为 Adapter Router。继续吗？`)) return;
    replaceExisting = true;
  }
  await request('/assistant/routing/use', {
    method: 'POST',
    body: JSON.stringify({ replace_existing: replaceExisting }),
  });
  await loadAssistantRouting();
  await loadParameters();
  $('assistant-routing-message').textContent = 'App endpoint 已写入并读取回确认。';
}

async function request(path, options = {}) {
  const response = await api(path, options);
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(body.detail ?? body.error ?? `HTTP ${response.status}`);
  }
  return body;
}

function appendText(parent, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function valueFromInput(field, input) {
  if (field.control === 'checkbox') return input.checked;
  if (field.control === 'number') {
    if (input.value.trim() === '') throw new Error('请输入数字。');
    const value = Number(input.value);
    if (!Number.isFinite(value)) throw new Error('请输入有效数字。');
    return value;
  }
  return input.value;
}

function renderControl(field, id) {
  let input;
  if (field.control === 'select') {
    input = document.createElement('select');
    for (const value of field.values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      input.append(option);
    }
    input.value = typeof field.value === 'string' ? field.value : field.default;
  } else {
    input = document.createElement('input');
    input.type = field.control === 'checkbox' ? 'checkbox' : field.control;
    if (field.control === 'checkbox') input.checked = field.value === true;
    else input.value = formatValue(field.value_available ? field.value : field.default) === '（空）'
      ? '' : (field.value_available ? String(field.value) : String(field.default ?? ''));
    if (field.control === 'number') {
      const minimum = field.validation.minimum ?? field.validation.min;
      const maximum = field.validation.maximum ?? field.validation.max;
      if (minimum !== undefined) input.min = String(minimum);
      if (maximum !== undefined) input.max = String(maximum);
      input.step = 'any';
      input.inputMode = 'decimal';
    }
    if (field.ui_hint === 'url') input.inputMode = 'url';
  }
  input.id = id;
  input.disabled = !field.writable;
  input.setAttribute('aria-label', field.key);
  return input;
}

function renderField(field, index) {
  const item = document.createElement('article');
  item.className = 'parameter-field';
  const label = document.createElement('label');
  label.className = 'parameter-label';
  label.htmlFor = `parameter-${index}`;
  label.textContent = field.key;
  item.append(label);
  appendText(item, 'p', 'parameter-description', field.description || '');

  const valueRow = document.createElement('div');
  valueRow.className = 'parameter-value-row';
  const input = renderControl(field, `parameter-${index}`);
  if (field.editable && field.writable) {
    valueRow.append(input);
  } else {
    const output = document.createElement('output');
    output.className = 'parameter-readonly';
    output.textContent = field.value_available
      ? formatValue(field.value)
      : `当前值读取失败；默认值：${formatValue(field.default)}`;
    valueRow.append(output);
  }
  item.append(valueRow);
  appendText(item, 'p', 'parameter-hint',
    `默认值：${formatValue(field.default)} · ${validationSummary(field.validation)}`);
  if (field.value_available === false) {
    appendText(item, 'p', 'parameter-warning', `当前值读取失败：${field.value_error ?? 'unknown'}`);
  }
  if (field.editable && !field.writable) {
    appendText(item, 'p', 'parameter-warning', `只读：${field.unsupported_reason ?? '此字段不可写'}`);
  }

  if (field.editable && field.writable) {
    const footer = document.createElement('div');
    footer.className = 'parameter-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'parameter-save';
    save.textContent = '保存';
    const status = document.createElement('span');
    status.className = 'parameter-save-status';
    save.addEventListener('click', async () => {
      if (input.reportValidity && !input.reportValidity()) return;
      let value;
      try { value = valueFromInput(field, input); } catch (error) {
        status.textContent = String(error?.message ?? '输入无效');
        status.className = 'parameter-save-status error';
        return;
      }
      save.disabled = true;
      status.textContent = '正在保存并读取回确认…';
      status.className = 'parameter-save-status';
      const result = await saveField(request, field, value);
      if (result.ok) {
        if (field.control === 'checkbox') input.checked = result.value === true;
        else input.value = result.value === null || result.value === undefined ? '' : String(result.value);
        status.textContent = '已保存并确认';
        status.className = 'parameter-save-status success';
      } else {
        status.textContent = `保存失败：${result.error}`;
        status.className = 'parameter-save-status error';
      }
      save.disabled = false;
    });
    footer.append(save, status);
    item.append(footer);
  }
  return item;
}

function renderParameters(parameters) {
  $('parameters-groups').replaceChildren();
  $('assistant-parameters-groups').replaceChildren();
  $('assistant-app-parameters').hidden = true;
  $('parameters-card').hidden = false;
  if (parameters?.available !== true) {
    const messages = {
      not_connected: '尚未连接 Android App。',
      schema_missing: 'App 参数 schema 不可用；现有连接设置与 API 目录仍可继续使用。',
      schema_version_unsupported: `App 参数 schema 版本不受支持（${parameters?.schema_version ?? '未知版本'}）。`,
      schema_malformed: 'App 参数 schema 格式无效，通用面板已停用。',
      schema_unavailable: '暂时无法读取 App 参数 schema。',
    };
    $('parameters-meta').textContent = '通用参数面板未启用。';
    parameterFacts = {
      available: false,
      schemaVersion: parameters?.schema_version ?? null,
      rendered: 0,
      filtered: Number(parameters?.filtered_field_count ?? 0),
      invalid: Number(parameters?.field_errors?.length ?? 0),
    };
    updateDiagnostics();
    setParameterStatus(messages[parameters?.reason] ?? messages.schema_unavailable, 'idle', '不可用');
    return;
  }

  const rendered = renderParameterGroups($('parameters-groups'), buildParameterGroups(parameters), 'parameter');
  const assistantRendered = renderParameterGroups(
    $('assistant-parameters-groups'), buildAssistantParameterGroups(parameters), 'assistant-parameter',
  );
  $('assistant-app-parameters').hidden = assistantRendered === 0;
  const skipped = Number(parameters.field_errors?.length ?? 0);
  const unsupported = Number(parameters.unsupported_fields?.length ?? 0);
  parameterFacts = {
    available: true,
    schemaVersion: parameters.schema_version,
    rendered,
    filtered: Number(parameters.filtered_field_count ?? 0),
    invalid: skipped,
  };
  updateDiagnostics();
  $('parameters-meta').textContent = `Schema ${parameters.schema_version} · ${rendered} 个参数`;
  $('parameters-count').textContent = `${rendered} 项`;
  $('parameters-count').className = 'pill ' + (skipped || unsupported ? 'idle' : 'ok');
  const notes = [];
  if (skipped) notes.push(`跳过 ${skipped} 个无效字段`);
  if (unsupported) notes.push(`${unsupported} 个字段暂不支持写入（只读显示）`);
  setParameterStatus(notes.join('；') || '参数来自 App Schema；保存将调用该字段声明的 App API。',
    skipped || unsupported ? 'idle' : 'ok');
}

function renderParameterGroups(container, groups, idPrefix) {
  let rendered = 0;
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'parameter-group';
    appendText(section, 'h3', 'parameter-category', group.category);
    group.fields.forEach((field) => section.append(renderField(field, `${idPrefix}-${rendered++}`)));
    container.append(section);
  }
  return rendered;
}

async function loadParameters() {
  const generation = ++parameterLoadGeneration;
  $('parameters-card').hidden = false;
  $('assistant-app-parameters').hidden = true;
  $('assistant-parameters-groups').replaceChildren();
  $('parameters-meta').textContent = '正在读取 App Schema 与当前配置…';
  $('parameters-groups').replaceChildren();
  $('parameters-count').textContent = '读取中';
  $('parameters-count').className = 'pill idle';
  parameterFacts = null;
  updateDiagnostics();
  try {
    const body = await request('/parameters');
    if (generation !== parameterLoadGeneration) return;
    renderParameters(body.parameters);
  } catch (error) {
    if (generation !== parameterLoadGeneration) return;
    $('parameters-meta').textContent = '通用参数面板未启用。';
    parameterFacts = { available: false, schemaVersion: null, rendered: 0, filtered: 0, invalid: 0 };
    updateDiagnostics();
    $('assistant-parameters-groups').replaceChildren();
    $('assistant-app-parameters').hidden = true;
    setParameterStatus(`App 参数 schema 不可用：${String(error?.message ?? error)}`, 'idle', '不可用');
  }
}

async function load() {
  const body = await request('/connection');
  render(body.connection);
  if (body.connection?.connected) {
    await Promise.all([loadParameters(), loadAssistantRouting()]);
  }
}

async function connect() {
  const token = $('token').value;
  const baseUrl = $('base-url').value.trim();
  if (!baseUrl || !token.trim()) throw new Error('请填写 API Base URL 与 App token');
  $('connect').disabled = true;
  $('message').textContent = '正在认证并读取 /api/app/apis?format=md…';
  try {
    const body = await request('/connection', {
      method: 'POST',
      body: JSON.stringify({ base_url: baseUrl, token }),
    });
    $('token').value = '';
    render(body.connection);
    $('message').textContent = body.connection?.connected
      ? '连接成功。API Markdown 已从 App 实时取得。'
      : '凭证已保存，但 App 当前不可达。';
    if (body.connection?.connected) await Promise.all([loadParameters(), loadAssistantRouting()]);
  } finally {
    $('token').value = '';
    $('connect').disabled = false;
  }
}

async function refresh() {
  $('refresh').disabled = true;
  $('message').textContent = '正在刷新 App API 目录…';
  try {
    const body = await request('/connection/refresh', { method: 'POST', body: '{}' });
    render(body.connection);
    $('message').textContent = 'API 目录已刷新。';
    if (body.connection?.connected) await Promise.all([loadParameters(), loadAssistantRouting()]);
  } finally {
    $('refresh').disabled = false;
  }
}

async function disconnect() {
  const body = await request('/connection', { method: 'DELETE' });
  render(body.connection);
  $('assistant-event-rows').replaceChildren();
  $('message').textContent = '已清除 Adapter 私有连接配置。';
}

function run(action) {
  action().catch((error) => {
    $('message').textContent = `操作失败：${String(error?.message ?? error)}`;
  });
}

window.TermuxOS.ready.then(() => {
  setupTabs();
  $('connect').addEventListener('click', () => run(connect));
  $('refresh').addEventListener('click', () => run(refresh));
  $('disconnect').addEventListener('click', () => run(disconnect));
  $('assistant-routing-save').addEventListener('click', () => run(saveAssistantRouting));
  $('assistant-use-router').addEventListener('click', () => run(useAssistantRouter));
  run(load);
});
