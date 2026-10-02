/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: Sanitized App config schema and the current values from existing App APIs.
 * [OUTPUT]: Owner-filtered generic and Assistant field/control models and one-field save results.
 * [POS]: Browser-safe schema renderer; it never receives the App token or arbitrary App URLs.
 * [PROTOCOL]: Render with DOM text nodes; enforce owner/ui_location and hide credential/internal/Speech fields.
 */

const KNOWN_CATEGORIES = new Set([
  'webview', 'connection', 'assistant', 'gate', 'segment', 'inference', 'geniex', 'ime',
]);
const TYPE_CONTROLS = Object.freeze({
  boolean: 'checkbox',
  enum: 'select',
  number: 'number',
  string: 'text',
});
const HINT_CONTROLS = Object.freeze({
  toggle: 'checkbox',
  select: 'select',
  number: 'number',
  url: 'text',
  path: 'text',
  text: 'text',
});
const SECRET_NAME = /(token|secret|credential|password)/i;
const SPEECH_CATEGORIES = new Set([
  'gate', 'segment', 'speech', 'asr', 'trigger', 'clap', 'mic', 'mic_lifecycle', 'audio_lifecycle',
]);
const SPEECH_KEY = /^(?:gate_|segment_|speech_|asr_|trigger_|clap_|voice_profile_|audio_(?:gate|segment|speech|asr|trigger|clap|lifecycle)(?:_|$)|mic_(?:gate|segment|speech|asr|trigger|lifecycle|enabled|demand|holder|source)(?:_|$))/i;
const GENERIC_LOCATION = 'ADAPTER_GENERIC_UI';
const SAFE_GENERIC_OWNERS_WITHOUT_LOCATION = new Set(['APP_CAPABILITY', 'FRAMEWORK_POLICY']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function isSensitive(field) {
  const key = String(field?.key ?? '');
  const passwordPolicyToggle = field?.type === 'boolean' && /allow_password$/i.test(key);
  return (SECRET_NAME.test(key) && !passwordPolicyToggle)
    || field?.sensitive === true
    || field?.deprecated === true
    || field?.retired === true
    || String(field?.owner ?? '').toUpperCase() === 'INTERNAL'
    || String(field?.category ?? '').toLowerCase() === 'internal';
}

function isSpeechField(field) {
  return String(field?.owner ?? '').trim().toUpperCase() === 'SPEECH'
    || SPEECH_CATEGORIES.has(String(field?.category ?? '').trim().toLowerCase())
    || SPEECH_KEY.test(String(field?.key ?? ''));
}

function isGenericField(field) {
  const location = String(field?.ui_location ?? '').trim().toUpperCase();
  if (location === GENERIC_LOCATION) return true;
  if (location !== '') return false;
  return field?.generic_ui_safe === true
    && SAFE_GENERIC_OWNERS_WITHOUT_LOCATION.has(String(field?.owner ?? '').trim().toUpperCase());
}

function normalizedField(field) {
  if (!isRecord(field) || typeof field.key !== 'string'
      || isSensitive(field) || isSpeechField(field) || !isGenericField(field)) return null;
  const control = TYPE_CONTROLS[field.type];
  if (!control || typeof field.editable !== 'boolean') return null;
  const validation = isRecord(field.validation) ? field.validation : {};
  const values = field.type === 'enum' && Array.isArray(validation.values)
    ? validation.values.filter((value) => typeof value === 'string') : [];
  if (field.type === 'enum' && values.length === 0) return null;
  const hint = HINT_CONTROLS[field.ui_hint];
  const category = String(field.category ?? '').trim().toLowerCase();
  return {
    ...field,
    category: KNOWN_CATEGORIES.has(category) ? category : 'Other',
    control: hint === control ? hint : control,
    validation,
    values,
    writable: field.editable === true && field.writable === true,
  };
}

export function buildParameterGroups(parameters) {
  if (!isRecord(parameters) || !Array.isArray(parameters.fields)) return [];
  const groups = new Map();
  for (const raw of parameters.fields) {
    const field = normalizedField(raw);
    if (!field || field.category === 'assistant') continue;
    if (!groups.has(field.category)) groups.set(field.category, []);
    groups.get(field.category).push(field);
  }
  return [...groups.entries()].map(([category, fields]) => ({ category, fields }));
}

export function buildAssistantParameterGroups(parameters) {
  if (!isRecord(parameters) || !Array.isArray(parameters.fields)) return [];
  const groups = new Map();
  for (const raw of parameters.fields) {
    const field = normalizedField(raw);
    if (!field || field.category !== 'assistant') continue;
    if (!groups.has(field.category)) groups.set(field.category, []);
    groups.get(field.category).push(field);
  }
  return [...groups.entries()].map(([category, fields]) => ({ category, fields }));
}

export function validationSummary(validation) {
  const parts = [];
  if (Array.isArray(validation?.values)) parts.push(`允许值：${validation.values.join(' / ')}`);
  const minimum = validation?.minimum ?? validation?.min;
  const maximum = validation?.maximum ?? validation?.max;
  if (minimum !== undefined || maximum !== undefined) {
    parts.push(`范围：${minimum ?? '−∞'}–${maximum ?? '+∞'}`);
  }
  if (validation?.write_validation) parts.push(String(validation.write_validation));
  return parts.join(' · ') || '无额外校验';
}

export function formatValue(value) {
  if (typeof value === 'string') return value === '' ? '（空）' : value;
  if (value === null || value === undefined) return '（无值）';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export async function saveField(apiRequest, field, value) {
  try {
    const result = await apiRequest('/parameters/write', {
      method: 'POST',
      body: JSON.stringify({ key: field.key, value }),
    });
    if (result?.ok !== true || result.field?.key !== field.key
        || !Object.prototype.hasOwnProperty.call(result.field, 'value')) {
      return { ok: false, error: '保存后未能读取回实际值。' };
    }
    return {
      ok: result.field.readback_matches === false ? false : true,
      value: result.field.value,
      error: result.field.readback_matches === false ? '读取回的值与提交值不同。' : '',
    };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? '保存失败') };
  }
}
