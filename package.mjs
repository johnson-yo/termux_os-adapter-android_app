/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: Package context, authenticated Android App API, Assistant envelope, and private route settings.
 * [OUTPUT]: Connection/parameter routes, namespaced Assistant router, android.app.api Action and Capability.
 * [POS]: App Adapter owns opt-in Assistant event routing; Framework Core keeps package dispatch generic.
 * [PROTOCOL]: Keep the App token backend-only and route only validated loopback HTTP targets.
 */

import { makeActions } from './adapter/actions.mjs';
import { startSpeechStates } from './adapter/speech-states.mjs';
import {
  clearConnection, loadConfig, normalizeBaseUrl, publicConfig, saveCatalog, saveConnected,
} from './adapter/config.mjs';
import { connectCandidate, getAppJson, getCatalog } from './adapter/client.mjs';
import { loadParameters, writeParameter } from './adapter/parameters.mjs';
import { probe } from './adapter/probe.mjs';
import {
  dispatchAssistantCall, loadAssistantRouting, normalizeAssistantEndpoint, routerIngressUrl,
  ROUTER_INGRESS_PATH, saveAssistantRouting,
} from './adapter/assistant-routing.mjs';

export async function register(context) {
  const configFile = context.configFile('android-app-connection.v1.json');
  const routingFile = context.configFile('assistant-event-routing.v1.json');
  for (const action of makeActions(configFile)) context.actions.register(action);

  // 狀態總線：只有本 Adapter 知道 App 此刻在不在說話，所以只有它能這樣說。
  // App 不主動通知，輪詢是本包自己的職責；停用/卸載時 cleanup 停掉它。
  context.lifecycle.register(startSpeechStates(context, configFile));

  context.capabilities.provide({
    id: 'android.app.api',
    provider: 'android-app',
    kind: 'action',
    action: 'android.app.api.describe',
  });

  const snapshot = async () => {
    const cfg = loadConfig(configFile);
    return publicConfig(cfg, { live: await probe(cfg) });
  };

  const routingStatus = async (req) => {
    const cfg = loadConfig(configFile);
    const routing = loadAssistantRouting(routingFile);
    const eventCatalog = { available: false, reason: 'not_connected', events: [] };
    const appEndpoint = { configured: false, hidden: false, value: '', matches_router: false };
    const ingressUrl = routerIngressUrl((req.socket?.localPort ?? Number(process.env.PORT)) || 8980);
    if (!cfg.token) return { routing, event_catalog: eventCatalog, router_ingress_url: ingressUrl, app_endpoint: appEndpoint };

    try {
      const catalog = await getAppJson(cfg, '/api/app/assistant/events');
      if (Array.isArray(catalog.events)) {
        const events = catalog.events.filter((event) => event && typeof event.name === 'string'
          && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(event.name))
          .map((event) => ({
            name: event.name,
            label: typeof event.label === 'string' ? event.label : event.name,
            description: typeof event.description === 'string' ? event.description : '',
            system_origin: event.system_origin === true,
          }));
        if (events.length) Object.assign(eventCatalog, { available: true, reason: '', events });
        else eventCatalog.reason = 'assistant_event_catalog_invalid';
      } else eventCatalog.reason = 'assistant_event_catalog_invalid';
    } catch {
      eventCatalog.reason = 'assistant_event_catalog_unavailable';
    }

    try {
      const appConfig = await getAppJson(cfg, '/api/app/config');
      const raw = typeof appConfig.assistant_primary_endpoint === 'string'
        ? appConfig.assistant_primary_endpoint.trim() : '';
      appEndpoint.configured = Boolean(raw);
      if (raw) {
        try {
          const value = normalizeAssistantEndpoint(raw);
          appEndpoint.value = value;
          appEndpoint.matches_router = value === ingressUrl;
        } catch { appEndpoint.hidden = true; }
      }
    } catch { appEndpoint.reason = 'app_config_unavailable'; }

    return { routing, event_catalog: eventCatalog, router_ingress_url: ingressUrl, app_endpoint: appEndpoint };
  };

  context.routes.register('GET', '/assistant/routing', async (req, res, { json }) => {
    try { json(res, 200, { ok: true, ...await routingStatus(req) }); }
    catch (error) {
      json(res, Number.isInteger(error?.status) ? error.status : 500,
        { ok: false, error: String(error?.message ?? 'assistant_routing_unavailable') });
    }
  });

  context.routes.register('POST', '/assistant/routing', async (req, res, { json, readBody }) => {
    try {
      const routing = saveAssistantRouting(routingFile, await readBody());
      json(res, 200, { ok: true, routing });
    } catch (error) {
      json(res, Number.isInteger(error?.status) ? error.status : 400,
        { ok: false, error: String(error?.message ?? 'assistant_routing_invalid') });
    }
  });

  context.routes.register('POST', '/assistant/routing/use', async (req, res, { json, readBody }) => {
    const cfg = loadConfig(configFile);
    if (!cfg.token) return json(res, 409, { ok: false, error: 'not_connected' });
    const body = await readBody();
    if (!body || (body.replace_existing !== undefined && typeof body.replace_existing !== 'boolean')) {
      return json(res, 400, { ok: false, error: 'assistant_router_confirmation_invalid' });
    }
    try {
      const endpoint = routerIngressUrl((req.socket?.localPort ?? Number(process.env.PORT)) || 8980);
      const appConfig = await getAppJson(cfg, '/api/app/config');
      const current = typeof appConfig.assistant_primary_endpoint === 'string'
        ? appConfig.assistant_primary_endpoint.trim() : '';
      let alreadySelected = false;
      if (current) {
        try { alreadySelected = normalizeAssistantEndpoint(current) === endpoint; } catch { /* Treat invalid values as existing user input. */ }
      }
      if (alreadySelected) return json(res, 200, { ok: true, already_selected: true, endpoint });
      if (current && body.replace_existing !== true) {
        return json(res, 409, {
          ok: false,
          error: 'assistant_endpoint_replace_confirmation_required',
          endpoint_hidden: (() => { try { normalizeAssistantEndpoint(current); return false; } catch { return true; } })(),
        });
      }
      const field = await writeParameter(cfg, 'assistant_primary_endpoint', endpoint);
      if (field.value !== endpoint || field.readback_matches === false) {
        return json(res, 502, { ok: false, error: 'assistant_endpoint_readback_mismatch' });
      }
      json(res, 200, { ok: true, already_selected: false, endpoint, field });
    } catch (error) {
      json(res, Number.isInteger(error?.status) ? error.status : 502,
        { ok: false, error: String(error?.message ?? 'assistant_router_setup_failed') });
    }
  });

  const assistantCall = async (req, res, { json, readBody }) => {
    try {
      const routing = loadAssistantRouting(routingFile);
      const body = req.method === 'POST' ? await readBody() : null;
      const result = await dispatchAssistantCall({ routing, method: req.method, headers: req.headers, body });
      json(res, result.status, result.payload);
    } catch (error) {
      json(res, Number.isInteger(error?.status) ? error.status : 500,
        { ok: false, error: String(error?.message ?? 'assistant_router_failed') });
    }
  };
  context.routes.register('GET', '/assistant/call', assistantCall);
  context.routes.register('POST', '/assistant/call', assistantCall);

  context.routes.register('GET', '/connection', async (req, res, { json }) => {
    json(res, 200, { ok: true, connection: await snapshot() });
  });

  context.routes.register('POST', '/connection', async (req, res, { json, readBody }) => {
    const body = await readBody();
    if (!body || typeof body.base_url !== 'string' || typeof body.token !== 'string') {
      return json(res, 400, { ok: false, error: 'base_url_and_token_required' });
    }
    try {
      const baseUrl = normalizeBaseUrl(body.base_url);
      const token = body.token.trim();
      if (!token) return json(res, 400, { ok: false, error: 'token_required' });
      const connected = await connectCandidate(baseUrl, token);
      const cfg = saveConnected(configFile, {
        baseUrl,
        token,
        catalogMd: connected.catalogMd,
      });
      json(res, 200, {
        ok: true,
        connection: publicConfig(cfg, { live: await probe(cfg) }),
      });
    } catch (error) {
      json(res, 502, {
        ok: false,
        error: 'android_app_connection_failed',
        detail: String(error?.message ?? error),
      });
    }
  });

  context.routes.register('POST', '/connection/refresh', async (req, res, { json }) => {
    try {
      const cfg = loadConfig(configFile);
      if (!cfg.token) return json(res, 409, { ok: false, error: 'not_connected' });
      const saved = saveCatalog(configFile, await getCatalog(cfg));
      json(res, 200, {
        ok: true,
        connection: publicConfig(saved, { live: await probe(saved) }),
      });
    } catch (error) {
      json(res, 502, {
        ok: false,
        error: 'android_app_refresh_failed',
        detail: String(error?.message ?? error),
      });
    }
  });

  context.routes.register('DELETE', '/connection', async (req, res, { json }) => {
    const cfg = clearConnection(configFile);
    json(res, 200, { ok: true, connection: publicConfig(cfg) });
  });

  context.routes.register('GET', '/parameters', async (req, res, { json }) => {
    const cfg = loadConfig(configFile);
    if (!cfg.token) {
      return json(res, 200, { ok: true, parameters: {
        available: false, reason: 'not_connected', fields: [], field_errors: [], unsupported_fields: [],
      } });
    }
    const parameters = await loadParameters(cfg);
    json(res, 200, { ok: true, parameters });
  });

  context.routes.register('POST', '/parameters/write', async (req, res, { json, readBody }) => {
    const cfg = loadConfig(configFile);
    if (!cfg.token) return json(res, 409, { ok: false, error: 'not_connected' });
    const body = await readBody();
    if (!body || typeof body.key !== 'string' || !Object.hasOwn(body, 'value')) {
      return json(res, 400, { ok: false, error: 'key_and_value_required' });
    }
    try {
      const field = await writeParameter(cfg, body.key, body.value);
      json(res, 200, { ok: true, field });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 502;
      json(res, status, { ok: false, error: String(error?.message ?? 'parameter_write_failed') });
    }
  });
}
