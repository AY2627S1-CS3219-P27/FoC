# Delivery venues: handoff (untracked, nothing committed)

Steps 6 to 8 are done as far as this machine allows. The branch review has been run and its findings are below. No source code was changed this session, apart from the progress file. Nothing is committed.

## State
- Uncommitted: AS8 rename migration and test (step 6); README, ADR 0002 amendment, Postman, demo script (step 7).
- Test results: unit 217 of 218, integration 148 of 164, messaging 5 of 5, e2e 59 of 59. The demo runs, including scenes 5a and 5b.
- The unit failure (`seed-csv.spec.ts`) also fails on a clean checkout. Node 22.15.1 here drops the `0x92` byte in `TextDecoder('windows-1252')`. All 16 integration failures show "expected 19 to be 21", which is the supplier seed CSV losing 2 rows. I believe it's the same cause but have not confirmed it.
- Test containers are down. `DELIVERY-VENUES-PROGRESS.md` is updated, and the venue count is 421 (not 422).
- On Windows run npm scripts from Git Bash with `export npm_config_script_shell="C:/Program Files/Git/bin/bash.exe"`. Pass `--testTimeout=60000 --hookTimeout=60000` to integration. The demo needs both `db:test:up` and `broker:test:up`, freshly started (a stale broker fails with a 406 TTL mismatch).

## Review findings, most serious first (from two read-only reviewers; I did not verify them)
1. AS8 `down()` is not symmetric. On a DB seeded from the JSON, `up()` does nothing, then `down()` renames to "Blk AS8", drops the alias and deletes the `artsandsocialsciences8` key, and never adds a `blkas8` key. Name lookups for that building then fail. The test only covers the pre-existing "Blk AS8" case.
2. AS8 `up()` inserts the new name key with `ON CONFLICT DO NOTHING`. If another building holds that key, the rename succeeds with no key and no error.
3. `BuildingSeedService.exists()` also matches `shortName`. An admin building named or aliased "PIN" blocks the pin placeholder, with no log. The spec says only to match on name.
4. The 16 integration failures need a re-run on a Node version where the Windows-1252 decode works.
5. Venue counts differ from the spec: 61 buildings and 421 venues, against an expected 60 and 425. The venue gap was flagged to the owner.
6. The venue-to-payload mapping is written three times: `supplier-validation.service.ts`, `toVenueView` in `buildings.controller.ts`, and `toView`.
7. The supplier, building, venue order is written twice in `supplier-validation.service.ts` (`validate` and `outcome`). `outcome` takes a `venueRequested` flag that repeats the `deliveryVenueId !== undefined` test.
8. The AS8 migration hand-writes alias and name-key SQL that `BuildingsService` owns, hard-codes `artsandsocialsciences8`, and its `rename()` hides the `'AS8'` filter.
9. `database.integration-spec.ts` counts undos from the end, so each new migration forces edits to old tests. Use a named migration instead.
10. Open: floor sort order (B2 before B1? is "M" after the numeric floors?).
11. Beyond the spec: the E3/E4 coordinate migration (owner approved), the "Blk AS8" alias, the demo script changes, the venue `code` and `name` length limits.
12. Confirm the README claim that the pin building is created at every startup if missing, in every environment.
13. `CONTEXT.md` has no "venue" or "map pin" entry (judgement call).
14. Minor: `VenuesService.retire` has no controller caller; the `at(...)` test helper hard-codes `1.296252, 103.772093`; a stray blank line in `migrations/index.ts`.

## Before the PR
- Fix items 1 to 3 (not started).
- The order-service owner must sign off on the contract names `deliveryVenueId`, `VENUE_NOT_FOUND` and `deliveryVenue`.
- The PR should say the owner approved the E3/E4 coordinate migration against the spec.
- Venues over 300 m from their building (E3, E4, I4-01-03) are still undecided by the owner.
- Rename the branch to `features/<issue#>-<slug>` and create the issue.
- Do not commit `DELIVERY-VENUES-*.md`.
