/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: The saved Android App connection (base URL + token) from `./config.mjs`, and the App's
 *          `/ws/android/events` push stream.
 * [OUTPUT]: A subscriber that publishes `speech.tts` and `audio.output.route` onto the state bus.
 * [POS]: This Adapter is the only party that knows whether the App is speaking, so it is the only
 *        party allowed to say so. docs/056 replaced the 100 ms poller with a subscription: the App
 *        knows exactly when playback starts and stops, so the cost of observing it should be
 *        proportional to how often the fact changes, not to how long we watch.
 * [PROTOCOL]: Never log or publish the saved token; states carry facts, never credentials.
 *             变更时更新此头部，然后检查 CLAUDE.md
 */
import { loadConfig } from './config.mjs';

const ROUTE_CLASSES = Object.freeze({
  builtin_speaker: 'built_in',
  builtin_earpiece: 'built_in',
  bluetooth_sco: 'bluetooth',
  bluetooth_a2dp: 'bluetooth',
  wired_headset: 'wired',
  wired_headphones: 'wired',
  usb_device: 'usb',
  usb_headset: 'usb',
  usb_accessory: 'usb',
});

/** `unknown` is an in-band value: failing to recognise a device is not the same as having no writer. */
export const outputRouteClass = (device) => {
  const raw = String(device?.type_name ?? '').toLowerCase();
  if (!raw) return 'unknown';
  return ROUTE_CLASSES[raw] ?? (raw.includes('bluetooth') ? 'bluetooth'
    : raw.includes('usb') ? 'usb'
      : raw.includes('wired') || raw.includes('head') ? 'wired'
        : raw.includes('built') ? 'built_in' : 'unknown');
};

/**
 * ⚠ These two readers are the whole reason docs/056 exists.
 *
 * The previous version looked for `speaking` / `playing` / `state` and for
 * `routed_output_device` / `preferred_output_device`. **The App emits none of those names** — it
 * emits `active` / `phase` and `routed_device` / `preferred_device`. So `speech.tts` was pinned to
 * `false` and `audio.output.route` to `unknown` for the entire life of the feature: echo
 * suppression never fired once, and nothing ever errored, logged, or looked wrong.
 *
 * A field name that does not exist reads as `undefined`, and `undefined === true` is simply
 * `false` — a wrong answer is indistinguishable from a legitimate one. That is why `app-playback
 * fixture` in the tests is pinned to a byte-for-byte capture of a real device response rather
 * than to something hand-written from memory.
 */
export const speakingFrom = (playback) => playback?.active === true;

export const routeDeviceFrom = (playback) => playback?.routed_device
  ?? playback?.preferred_device
  ?? null;

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

const eventsEndpoint = (baseUrl) => {
  const url = new URL('/ws/android/events', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

export function startSpeechStates(context, configFile) {
  let socket = null;
  let retryTimer = null;
  let stopped = false;
  let attempt = 0;
  let config = null;
  const published = new Map();

  /**
   * Push on change — the bus may drop intermediates, so repeating a value says nothing.
   *
   * The exception is a claim under `max_age_ms`. That bound exists to catch a writer that hangs
   * while asserting something, so it must only apply while the claim is being asserted: "I am
   * speaking" is a claim, "I am not speaking" is the resting state and may legitimately last for
   * hours. Refreshing only the asserted value keeps the guard meaningful without turning it into a
   * heartbeat for everything — which is exactly why the App only sends `keepalive` while active.
   */
  const push = (name, value, { refreshWhile = undefined } = {}) => {
    const asserted = refreshWhile !== undefined && value === refreshWhile;
    if (published.get(name) === value && !asserted) return;
    try { context.states.set(name, value); published.set(name, value); }
    catch { /* not registered yet or out of domain: try again next frame, never break the proxy */ }
  };

  const applyPlayback = (playback) => {
    if (!playback || typeof playback !== 'object') return;
    push('speech.tts', speakingFrom(playback), { refreshWhile: true });
    push('audio.output.route', outputRouteClass(routeDeviceFrom(playback)));
  };

  /**
   * Config is read once per connection attempt, not per observation. The App's token is rotated by
   * app updates, so re-reading on every reconnect is what actually matters; re-reading ten times a
   * second only burned CPU.
   */
  const currentConfig = () => {
    try { config = loadConfig(configFile); } catch { /* keep the last good one */ }
    return config;
  };

  const scheduleReconnect = () => {
    if (stopped || retryTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    attempt += 1;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, delay);
    if (typeof retryTimer.unref === 'function') retryTimer.unref();
  };

  function connect() {
    if (stopped) return;
    const cfg = currentConfig();
    if (!cfg?.base_url || !cfg?.token) { scheduleReconnect(); return; }

    let ws;
    try {
      ws = new WebSocket(eventsEndpoint(cfg.base_url), {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
    } catch { scheduleReconnect(); return; }
    socket = ws;

    ws.onopen = () => { attempt = 0; };

    ws.onmessage = (event) => {
      let frame = null;
      try { frame = JSON.parse(String(event.data)); } catch { return; }
      // snapshot / tts.playback / keepalive all carry the same payload, so one path handles all.
      applyPlayback(frame?.data);
    };

    const drop = () => {
      if (socket === ws) socket = null;
      // Deliberately do NOT clear the states. If we were asserting `speech.tts=true` when the link
      // died, the claim must go stale rather than flip to false — `max_age_exceeded` makes the
      // guard suppress, and suppressing a mic we can no longer reason about is the safe direction.
      // The resting `false` carries no max_age and stays live, so silence never blinds the gate.
      published.delete('speech.tts');
      scheduleReconnect();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* already gone */ } };
    ws.onclose = drop;
  }

  connect();

  return () => {
    stopped = true;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (socket) { try { socket.close(); } catch { /* already gone */ } socket = null; }
  };
}
