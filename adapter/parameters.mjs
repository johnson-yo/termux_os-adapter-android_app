/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: A private App connection plus the App's versioned config schema and declared endpoints.
 * [OUTPUT]: Sanitized parameter metadata/current values and writes through the declared App APIs.
 * [POS]: Server-side schema bridge; the App token never crosses into the browser.
 * [PROTOCOL]: Never accept an arbitrary App path or return undeclared config keys to the WebUI.
 */

import { getAppJson, postAppJson } from './client.mjs';

export const APP_CONFIG_SCHEMA_PATH = '/api/app/config/schema';
export const SUPPORTED_SCHEMA_VERSION = '1.0.0';

const READ_ENDPOINTS = new Set([
  'GET /api/app/config',
  'GET /api/audio/gate/state',
  'GET /api/ime/status',
]);
const WRITE_ENDPOINTS = new Set([
  'POST /api/app/config',
  'POST /api/audio/gate/config',
  'POST /api/ime/config',
]);
const SAFE_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const SECRET_NAME = /(token|secret|credential|password)/i;
const CREDENTIAL_NAME = /(token|secret|credential)/i;
const TYPES = new Set(['boolean', 'enum', 'number', 'string']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const unavailable = (reason, schemaVersion = null) => ({
  available: false,
  reason,
  schema_version: schemaVersion,
  fields: [],
  field_errors: [],
  unsupported_fields: [],
});

function isSensitiveField(field) {
  const passwordPolicyToggle = field.type === 'boolean' && /allow_password$/i.test(field.key);
  return (SECRET_NAME.test(field.key) && !passwordPolicyToggle)
    || field.sensitive === true
    || String(field.category ?? '').toLowerCase() === 'internal'
    || String(field.owner ?? '').toUpperCase() === 'INTERNAL';
}

function validateDefault(type, value, validation) {
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'enum') return typeof value === 'string'
    && Array.isArray(validation.values)
    && validation.values.includes(value);
  return type === 'string' && typeof value === 'string';
}

function parseField(raw, index) {
  if (!isRecord(raw) || typeof raw.key !== 'string' || !SAFE_KEY.test(raw.key)) {
    throw Object.assign(new Error('invalid_key'), { index });
  }
  if (isSensitiveField(raw)) return null;
  if (!TYPES.has(raw.type)) throw Object.assign(new Error('unsupported_type'), { index, key: raw.key });
  if (typeof raw.editable !== 'boolean') throw Object.assign(new Error('editable_missing'), { index, key: raw.key });
  if (!isRecord(raw.validation)) throw Object.assign(new Error('validation_missing'), { index, key: raw.key });
  if (!validateDefault(raw.type, raw.default, raw.validation)) {
    throw Object.assign(new Error('default_type_mismatch'), { index, key: raw.key });
  }
  if (typeof raw.description !== 'string') {
    throw Object.assign(new Error('description_missing'), { index, key: raw.key });
  }
  if (typeof raw.read_endpoint !== 'string' || !raw.read_endpoint.startsWith('GET ')) {
    throw Object.assign(new Error('read_endpoint_missing'), { index, key: raw.key });
  }
  if (raw.editable && (typeof raw.write_endpoint !== 'string' || !raw.write_endpoint.startsWith('POST '))) {
    throw Object.assign(new Error('write_endpoint_missing'), { index, key: raw.key });
  }
  return {
    key: raw.key,
    type: raw.type,
    default: raw.default,
    editable: raw.editable,
    category: typeof raw.category === 'string' && raw.category.trim() ? raw.category : 'Other',
    description: raw.description,
    validation: raw.validation,
    read_endpoint: raw.read_endpoint,
    write_endpoint: typeof raw.write_endpoint === 'string' ? raw.write_endpoint : '',
    read_field: typeof raw.read_field === 'string' && raw.read_field ? raw.read_field : raw.key,
    write_field: typeof raw.write_field === 'string' && raw.write_field ? raw.write_field : raw.key,
    read_transform: typeof raw.read_transform === 'string' ? raw.read_transform : '',
    ui_hint: typeof raw.ui_hint === 'string' ? raw.ui_hint : '',
    owner: typeof raw.owner === 'string' ? raw.owner : '',
    ui_location: typeof raw.ui_location === 'string' ? raw.ui_location : '',
  };
}

export function parseSchema(document) {
  if (!isRecord(document) || !Array.isArray(document.entries)) {
    const error = new Error('schema_malformed');
    error.code = 'schema_malformed';
    throw error;
  }
  if (typeof document.schema_version !== 'string') {
    const error = new Error('schema_malformed');
    error.code = 'schema_malformed';
    throw error;
  }
  if (document.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    const error = new Error('schema_version_unsupported');
    error.code = 'schema_version_unsupported';
    error.schemaVersion = typeof document.schema_version === 'string' ? document.schema_version : null;
    throw error;
  }
  const fields = [];
  const fieldErrors = [];
  document.entries.forEach((raw, index) => {
    try {
      const field = parseField(raw, index);
      if (field) fields.push(field);
    } catch (error) {
      fieldErrors.push({
        index: index + 1,
        key: typeof error.key === 'string' ? error.key : null,
        error: String(error.message ?? 'invalid_field'),
      });
    }
  });
  return {
    available: true,
    schema_version: SUPPORTED_SCHEMA_VERSION,
    fields,
    field_errors: fieldErrors,
  };
}

function parseEndpoint(endpoint, supported) {
  if (typeof endpoint !== 'string' || !supported.has(endpoint)) return null;
  const space = endpoint.indexOf(' ');
  return { method: endpoint.slice(0, space), path: endpoint.slice(space + 1) };
}

function convertReadValue(field, response) {
  if (!isRecord(response)) throw new Error('read_response_invalid');
  let value = response[field.read_field];
  if (value === undefined) throw new Error('read_value_missing');
  if (field.read_transform) {
    const match = /^(true|false)\s+when\s+([A-Za-z0-9_.-]+)\s+is\s+(.+)$/i.exec(field.read_transform.trim());
    if (!match) throw new Error('read_transform_unsupported');
    const transformValue = response[match[2]];
    if (transformValue === undefined) throw new Error('read_transform_source_missing');
    value = String(transformValue) === match[3] ? match[1].toLowerCase() === 'true' : match[1].toLowerCase() !== 'true';
  }
  if (!validateDefault(field.type, value, field.validation)) throw new Error('read_value_type_mismatch');
  return value;
}

async function readField(cfg, field, cache = new Map()) {
  const endpoint = parseEndpoint(field.read_endpoint, READ_ENDPOINTS);
  if (!endpoint) throw new Error('unsupported_read_endpoint');
  if (!cache.has(endpoint.path)) cache.set(endpoint.path, getAppJson(cfg, endpoint.path));
  const response = await cache.get(endpoint.path);
  return convertReadValue(field, response);
}

async function getParsedSchema(cfg) {
  try {
    return parseSchema(await getAppJson(cfg, APP_CONFIG_SCHEMA_PATH));
  } catch (error) {
    if (error.status === 404) return unavailable('schema_missing');
    if (error.code === 'schema_malformed' || error.message === 'android_app_json_invalid') {
      return unavailable('schema_malformed');
    }
    if (error.code === 'schema_version_unsupported') {
      return unavailable('schema_version_unsupported', error.schemaVersion);
    }
    return unavailable('schema_unavailable');
  }
}

export async function loadParameters(cfg) {
  const parsed = await getParsedSchema(cfg);
  if (parsed.available === false) return parsed;
  const endpointCache = new Map();
  const fields = await Promise.all(parsed.fields.map(async (field) => {
    const readEndpoint = parseEndpoint(field.read_endpoint, READ_ENDPOINTS);
    const writeEndpoint = parseEndpoint(field.write_endpoint, WRITE_ENDPOINTS);
    const writable = field.editable && Boolean(readEndpoint) && Boolean(writeEndpoint);
    const unsupportedReason = !readEndpoint ? 'unsupported_read_endpoint'
      : field.editable && !writeEndpoint ? 'unsupported_write_endpoint' : '';
    try {
      const value = await readField(cfg, field, endpointCache);
      return { ...field, value, value_available: true, writable, unsupported_reason: unsupportedReason };
    } catch (error) {
      return {
        ...field,
        value: field.default,
        value_available: false,
        value_error: String(error.message ?? 'read_failed'),
        writable,
        unsupported_reason: unsupportedReason,
      };
    }
  }));
  const unsupportedFields = fields
    .filter((field) => field.editable && !field.writable)
    .map((field) => ({ key: field.key, reason: field.unsupported_reason || 'unsupported_write_endpoint' }));
  return {
    available: true,
    schema_version: parsed.schema_version,
    fields,
    field_errors: parsed.field_errors,
    unsupported_fields: unsupportedFields,
  };
}

export async function writeParameter(cfg, key, value) {
  if (typeof key !== 'string' || !SAFE_KEY.test(key) || CREDENTIAL_NAME.test(key)) {
    throw Object.assign(new Error('parameter_not_allowlisted'), { status: 400 });
  }
  const parsed = await getParsedSchema(cfg);
  if (parsed.available === false) {
    throw Object.assign(new Error(parsed.reason), { status: parsed.reason === 'schema_missing' ? 409 : 400 });
  }
  const field = parsed.fields.find((candidate) => candidate.key === key);
  if (!field || !field.editable) {
    throw Object.assign(new Error('parameter_not_editable'), { status: 400 });
  }
  const endpoint = parseEndpoint(field.write_endpoint, WRITE_ENDPOINTS);
  if (!endpoint) throw Object.assign(new Error('unsupported_write_endpoint'), { status: 422 });
  if (!validateDefault(field.type, value, field.validation)) {
    throw Object.assign(new Error('parameter_value_invalid'), { status: 400 });
  }
  await postAppJson(cfg, endpoint.path, { [field.write_field]: value });
  const actual = await readField(cfg, field);
  return {
    key: field.key,
    value: actual,
    readback_matches: Object.is(actual, value),
  };
}
