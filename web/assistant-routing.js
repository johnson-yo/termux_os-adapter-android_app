/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: Runtime Assistant event catalog and the Adapter's private route map
 * [OUTPUT]: Validated event metadata and dynamic row models for Assistant Event Routing
 * [POS]: Pure browser-side model helper; it contains no fixed App event names or credentials
 * [PROTOCOL]: Preserve unknown route entries and keep rendering driven by the live App catalog
 */

const SOURCE_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export function normalizeEventCatalog(value) {
  if (!value || value.available !== true || !Array.isArray(value.events)) {
    return { available: false, reason: value?.reason || 'assistant_event_catalog_unavailable', events: [] };
  }
  const seen = new Set();
  const events = value.events.filter((event) => event && typeof event.name === 'string'
    && SOURCE_ID.test(event.name) && !seen.has(event.name) && seen.add(event.name))
    .map((event) => ({
      name: event.name,
      label: typeof event.label === 'string' && event.label.trim() ? event.label : event.name,
      description: typeof event.description === 'string' ? event.description : '',
      system_origin: event.system_origin === true,
    }));
  return events.length
    ? { available: true, reason: '', events }
    : { available: false, reason: 'assistant_event_catalog_empty', events: [] };
}

export function buildAssistantEventRows(catalog, eventRoutes = {}) {
  const normalized = normalizeEventCatalog(catalog);
  if (!normalized.available) return [];
  return normalized.events.map((event) => ({
    ...event,
    endpoint: typeof eventRoutes?.[event.name] === 'string' ? eventRoutes[event.name] : '',
  }));
}
