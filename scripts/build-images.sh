#!/usr/bin/env bash
# Build the service images tagged with each app's package.json version.
#
#   ./scripts/build-images.sh                build all six service images
#   ./scripts/build-images.sh --print-tags   print <SVC>_IMAGE_TAG=<version> lines
#   ./scripts/build-images.sh <compose...>   export the tags and run
#                                            `docker compose <compose...>`
#
# The compose files read the tags as ${<SVC>_IMAGE_TAG:-dev}, so plain
# `docker compose` (without this script) keeps building the `dev` images.
set -euo pipefail
cd "$(dirname "$0")/.."

services=(user-service credit-service order-service supplier-service email-service frontend)

# Map a service dir to its compose tag variable. Supplier uses the shorter
# SUPPLIER_* prefix convention in its compose file.
tag_var() {
  local svc="${1//-/_}"
  if [ "$svc" = "supplier_service" ]; then
    svc="supplier"
  fi
  printf '%s_IMAGE_TAG' "${svc^^}"
}

# Read version values from pacakge.json
print_tags() {
  local svc
  for svc in "${services[@]}"; do
    printf '%s=%s\n' "$(tag_var "$svc")" \
      "$(node -p "require('./$svc/package.json').version")"
  done
}

if [ "${1:-}" = "--print-tags" ]; then
  print_tags
  exit 0
fi

set -a
eval "$(print_tags)"
set +a

if [ "$#" -gt 0 ]; then
  exec docker compose "$@"
fi

docker compose build
