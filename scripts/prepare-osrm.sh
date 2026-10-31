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

# Keep this default in sync with osrm/compose.yml.
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

# Build in a scratch dir next to $out, then swap it in with two renames, so a failed build never
# touches the current dataset (the swap is two renames, not one atomic step: a sub-millisecond gap
# where $out is missing). Restart a running router afterwards: docker compose --profile routing restart osrm
work="$(mktemp -d "$(dirname "$out")/.osrm-build.XXXXXX")"
trap 'rm -rf "$work"' EXIT
cp "$pbf" "$work/singapore.osm.pbf"

osrm() {
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/$work:/data" "$image" "$@"
}

osrm osrm-extract -p /opt/foot.lua /data/singapore.osm.pbf
osrm osrm-partition /data/singapore.osrm
osrm osrm-customize /data/singapore.osrm

rm -f "$work/singapore.osm.pbf"
chmod 755 "$work" # mktemp creates 0700; the router container may run as another user
rm -rf "$out.old"
[ -d "$out" ] && mv "$out" "$out.old"
mv "$work" "$out"
rm -rf "$out.old"
echo "Done. Start the router with: docker compose --profile routing up -d osrm"
