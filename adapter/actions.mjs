/**
 * SPDX-License-Identifier: Apache-2.0
 * [INPUT]: A Package-private connection file containing a proven App base URL/token/API catalog.
 * [OUTPUT]: android.app.api.describe Action returning the provider descriptor to trusted Packages.
 * [POS]: The thin bridge between replaceable Android App credentials and Capability consumers.
 * [PROTOCOL]: The descriptor contains a token by explicit contract; expose it only through the authenticated Capability path.
 */

import { loadConfig, saveCatalog } from './config.mjs';
import { getCatalog } from './client.mjs';
import { probe } from './probe.mjs';

export function makeActions(configFile) {
  return [{
    id: 'android.app.api.describe',
    name: 'Describe Android App API',
    adapter: 'android-app',
    available: async () => (await probe(loadConfig(configFile))).ok,
    run: async (input = {}) => {
      let cfg = loadConfig(configFile);
      if (!cfg.token) throw new Error('not_connected');
      if (input && typeof input === 'object' && input.refresh_catalog === true) {
        cfg = saveCatalog(configFile, await getCatalog(cfg));
      }
      const live = await probe(cfg);
      if (!live.ok) throw new Error(live.reason);
      return {
        schema: 'termux-os.android-app-api.v1',
        base_url: cfg.base_url,
        token: cfg.token,
        headers: { Authorization: `Bearer ${cfg.token}` },
        catalog_md: cfg.catalog_md,
        connected_at: cfg.connected_at,
        refreshed_at: cfg.refreshed_at,
        live,
      };
    },
  }];
}
