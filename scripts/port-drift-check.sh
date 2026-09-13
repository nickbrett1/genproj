#!/usr/bin/env bash
# scripts/port-drift-check.sh
#
# Compares a file ported into genproj against the ftn source it came from, so a
# silently dropped line in a "move" is visible. Both sides are run through
# prettier with identical options first (`--no-config`, so neither repo's
# .prettierrc wins) and import lines are stripped, which leaves a diff of the
# code that actually does something.
#
# Usage:  bash scripts/port-drift-check.sh
#
# Expected output is "IDENTICAL" for every pair except the ones listed under
# KNOWN DIFFERENCES. Anything else is a porting bug.

set -uo pipefail

FTN_ROOT=${FTN_ROOT:-/workspaces/ftn/webapp/src/lib}
GENPROJ_ROOT=$(cd "$(dirname "$0")/.." && pwd)/src

# Differences that are intentional, with the reason. Everything else must match.
#   file-generator          - `?raw` template imports rewritten to consts from
#                             templates.generated.js (esbuild cannot inline ?raw)
#   preview-generator       - same, plus capability -> template wiring moved to
#                             capability-templates.js, and unused eslint
#                             directives dropped (genproj downgrades that rule)
#   capability-template-utils - dead `imageVisibility` local removed
#   project-generator       - unused `capabilities` param annotated only

normalise() {
  npx --no-install prettier --no-config --no-editorconfig \
    --tab-width 2 --print-width 80 --single-quote false --trailing-comma all \
    --parser babel "$1" 2>/dev/null |
    grep -v -E "^[[:space:]]*import " |
    grep -v -E "^[[:space:]]*export \{.*\} from " |
    sed 's/[[:space:]]*$//' | grep -v '^$'
}

status=0
compare() { # <ftn path> <genproj path> <label>
  local ftn=$1 genproj=$2 label=$3
  if [ ! -f "$genproj" ]; then
    echo "MISSING    $label (no genproj counterpart)"
    status=1
    return
  fi
  local changed
  changed=$(diff <(normalise "$ftn") <(normalise "$genproj") | grep -c '^[<>]')
  if [ "$changed" = "0" ]; then
    echo "IDENTICAL  $label"
  else
    echo "DIFFERS    $label ($changed changed lines - check it is an expected one)"
    status=1
  fi
}

compare "$FTN_ROOT/server/base-api-service.js" "$GENPROJ_ROOT/clients/base-api-service.js" base-api-service
compare "$FTN_ROOT/server/github-api.js" "$GENPROJ_ROOT/clients/github-api.js" github-api
compare "$FTN_ROOT/server/circleci-api.js" "$GENPROJ_ROOT/clients/circleci-api.js" circleci-api
compare "$FTN_ROOT/server/buildkite-api.js" "$GENPROJ_ROOT/clients/buildkite-api.js" buildkite-api
compare "$FTN_ROOT/server/doppler-api.js" "$GENPROJ_ROOT/clients/doppler-api.js" doppler-api
compare "$FTN_ROOT/server/sonarcloud-api.js" "$GENPROJ_ROOT/clients/sonarcloud-api.js" sonarcloud-api
compare "$FTN_ROOT/server/capability-config.js" "$GENPROJ_ROOT/generator/capability-config.js" capability-config
compare "$FTN_ROOT/server/external-service-integration.js" "$GENPROJ_ROOT/generator/external-service-integration.js" external-service-integration
compare "$FTN_ROOT/server/project-generator.js" "$GENPROJ_ROOT/generator/project-generator.js" project-generator
compare "$FTN_ROOT/utils/genproj-errors.js" "$GENPROJ_ROOT/generator/genproj-errors.js" genproj-errors
compare "$FTN_ROOT/utils/genproj-overwrite.js" "$GENPROJ_ROOT/generator/genproj-overwrite.js" genproj-overwrite
compare "$FTN_ROOT/config/external-services.js" "$GENPROJ_ROOT/generator/external-services.js" external-services
compare "$FTN_ROOT/utils/file-generator.js" "$GENPROJ_ROOT/generator/file-generator.js" file-generator
compare "$FTN_ROOT/utils/capability-template-utils.js" "$GENPROJ_ROOT/generator/capability-template-utils.js" capability-template-utils
compare "$FTN_ROOT/server/preview-generator.js" "$GENPROJ_ROOT/generator/preview-generator.js" preview-generator

exit $status
