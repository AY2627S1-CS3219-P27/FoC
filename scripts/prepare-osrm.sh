#!/usr/bin/env bash
# Preprocess the Singapore OSM extract for the `osrm` compose service (foot profile, MLD).
#
#   ./scripts/prepare-osrm.sh            build data/osrm/ if missing or older than the pbf
#   ./scripts/prepare-osrm.sh --force    rebuild even if up to date
#
# Input:  data/osm/singapore.osm.pbf
# Output: data/osrm/singapore.osrm* (gitignored; safe to delete and re-run)
# Re-run only when the map data is refreshed. Needs a running Docker daemon.
set -euo pipefail
cd "$(dirname "$0")/.."

image="ghcr.io/project-osrm/osrm-backend:${OSRM_IMAGE_TAG:-v5.27.1}"
pbf="data/osm/singapore.osm.pbf"
out="data/osrm"
marker="$out/singapore.osrm.mldgr" # last file written by osrm-customize

force=false
[ "${1:-}" = "--force" ] && force=true

if [ ! -f "$pbf" ]; then
  echo "error: $pbf not found. Cut it from a larger OSM file, e.g.:" >&2
  echo "  osmium extract --bbox 103.60,1.15,104.10,1.48 --strategy complete_ways -o $pbf <source>.osm.pbf" >&2
  exit 1
fi

if [ "$force" = false ] && [ -f "$marker" ] && [ "$marker" -nt "$pbf" ]; then
  echo "$out is up to date (use --force to rebuild)."
  exit 0
fi

# Build in a scratch dir and swap in at the end so a failed run never leaves a half-built dataset.
mkdir -p "$out"
work="$(mktemp -d "$out/.build.XXXXXX")"
trap 'rm -rf "$work"' EXIT
cp "$pbf" "$work/singapore.osm.pbf"

osrm() {
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/$work:/data" "$image" "$@"
}

osrm osrm-extract -p /opt/foot.lua /data/singapore.osm.pbf
osrm osrm-partition /data/singapore.osrm
osrm osrm-customize /data/singapore.osrm

rm -f "$out"/singapore.osrm*
rm -f "$work/singapore.osm.pbf"
mv "$work"/singapore.osrm* "$out"/
echo "Done. Start the router with: docker compose up -d osrm"
