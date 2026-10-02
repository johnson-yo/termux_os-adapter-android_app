#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# [INPUT]: The Package backend/WebUI modules and isolated host/mock tests.
# [OUTPUT]: Syntax plus backend, schema-ownership, routing, and WebUI contract PASS/FAIL evidence.
# [POS]: scripts/smoke.sh in the generated Extension Package.
# [PROTOCOL]: Test only this Package; do not invoke unrelated historical suites.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
fail=0
node --check "$HERE/package.mjs" && echo "PASS backend syntax" || { echo "FAIL backend syntax"; fail=1; }
node --check "$HERE/adapter/client.mjs" && node --check "$HERE/adapter/parameters.mjs" \
  && node --check "$HERE/adapter/assistant-routing.mjs" \
  && echo "PASS parameter bridge syntax" || { echo "FAIL parameter bridge syntax"; fail=1; }
node --input-type=module --check < "$HERE/web/parameters.js" \
  && node --input-type=module --check < "$HERE/web/assistant-routing.js" \
  && node --input-type=module --check < "$HERE/web/app.js" \
  && echo "PASS WebUI module syntax" || { echo "FAIL WebUI module syntax"; fail=1; }
node "$HERE/test/self-test.mjs" || fail=1
node "$HERE/test/parameters-test.mjs" || fail=1
node "$HERE/test/assistant-routing-test.mjs" || fail=1
node "$HERE/test/ui-contract-test.mjs" || fail=1
echo "smoke: $([ $fail -eq 0 ] && echo ALL PASS || echo FAILED)"
exit $fail
