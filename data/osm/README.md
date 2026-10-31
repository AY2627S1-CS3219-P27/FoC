# data/osm

`singapore.osm.pbf` is the OpenStreetMap extract that `scripts/prepare-osrm.sh` turns into the
OSRM routing data used for courier tracking.

## Provenance

- Source file: TODO (e.g. which Geofabrik / planet extract it was cut from)
- Extract date: TODO
- Bounding box: unknown. The tracking box (`TRACKING_BBOX=103.62,1.22,104.03,1.47`) and the spec's
  suggested cut (`103.60,1.15,104.10,1.48`) are NOT guaranteed to match this file.

## Licence

OpenStreetMap data is licensed under the ODbL 1.0. Attribution required:
"Contains OpenStreetMap data, © OpenStreetMap contributors" (https://www.openstreetmap.org/copyright).
Show it wherever the map or routes are displayed.

## Regenerating

```sh
osmium extract --bbox 103.60,1.15,104.10,1.48 --strategy complete_ways \
  -o data/osm/singapore.osm.pbf <source>.osm.pbf
./scripts/prepare-osrm.sh --force
docker compose --profile routing restart osrm
```
