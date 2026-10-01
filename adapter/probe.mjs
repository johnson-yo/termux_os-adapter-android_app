/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: Private Android App Adapter configuration.
 * [OUTPUT]: A small truthful liveness result with no credential material.
 * [POS]: Availability check shared by the Capability and the Adapter control page.
 * [PROTOCOL]: Failure reasons identify the layer, never the token value.
 */

import { getAppStatus } from './client.mjs';

export async function probe(cfg) {
  if (!cfg?.base_url || !cfg?.token) return { ok: false, reason: 'not_configured' };
  try {
    const status = await getAppStatus(cfg);
    return {
      ok: true,
      app: status.app ?? status.name ?? 'termux_os.app',
      version: status.version ?? status.version_name ?? null,
    };
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}
