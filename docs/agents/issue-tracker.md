# Issue tracker: GitHub

Issues live in `AY2627S1-CS3219-P27/FoC`. Use the `gh` CLI for all operations. The product backlog was created up front; each issue has a Sprint and, mostly, a Priority.

## Issue conventions

These govern issues **agents** raise (and the seeded backlog). Issues a dev raises and titles themselves are their own concern: don't rewrite them to fit.

- **Bugs**: do not use the requirement format. Use a descriptive title that says what is wrong (e.g. `Refresh token still accepted after logout`). Put the details in the body: what happens vs. what's expected, repro steps, affected service, and related or blocking issues (`Related: #12`, `Blocked by: #34`). Label `bug` plus the relevant `module.*`.
- **Requirement title** (features / seeded backlog): `[M.x][Fy.z.w] <requirement>`.
  - `M.x` = must-have module (M.1 user, M.2 supplier, M.3 order); `N.x` = nice-to-have module (N.1 notifications, N.2 AI, N.3 admin analytics, N.4 deployment + ratings).
  - `Fy.z.w` = requirement number; nesting is hierarchical (`F1.1.1` refines `F1.1`, which refines `F1`). Read the parent before working a child.
- **Labels**: one `module.*` label per issue (`module.user-management`, `module.supplier`, `module.order`, `module.real-time-notifications`, `module.ai-features`, `module.admin-analytics-dashboard`, `module.courier-and-requester-feedback-system`). Issue bodies are empty; the title is the spec.
- **Fields** (not labels):
  - **Priority**: org issue field, `Urgent` > `High` > `Medium` > `Low`.
  - **Sprint**: Project #1 iteration field (`Sprint 1` … `Sprint 8`, weekly, Sprint 1 starts 2026-09-17).
  - **Refinement Level**: org issue field, number 1-3.
  - **Status**: Project #1, `Todo` / `In progress` / `Done`.
- **Never guess Priority or Sprint.** Leave them to a human.

## Commands

- **Create an issue**: `gh issue create --title "..." --body "..." --label module.<x>` (heredoc for multi-line bodies)
- **Read an issue**: `gh issue view <number> --comments`
- **List issues**: `gh issue list --state open --json number,title,labels --jq '.[] | {number, title, labels: [.labels[].name]}'`
- **Comment / label / close**: `gh issue comment <n> --body "..."`, `gh issue edit <n> --add-label "..." / --remove-label "..."`, `gh issue close <n> --comment "..."`
- **Sprint / Status for all issues**: `gh project item-list 1 --owner AY2627S1-CS3219-P27 --limit 600 --format json` (needs `read:project` scope; each item has `sprint.title` and `status`).
- **Priority / Refinement Level for one issue** (issue fields need the feature header):
  ```
  gh api graphql -H "GraphQL-Features: issue_fields" -f query='{repository(owner:"AY2627S1-CS3219-P27",name:"FoC"){issue(number:N){issueFieldValues(first:10){nodes{__typename ... on IssueFieldSingleSelectValue{name field{... on IssueFieldSingleSelect{name}}} ... on IssueFieldNumberValue{value field{... on IssueFieldNumber{name}}}}}}}}'
  ```
  Paginate `issues(first:100, after:$c)` in the same shape to read them in bulk.

## Branches and PRs

- New features: `features/<issue#>-<short-slug>` (e.g. `features/1-otp-generation`).
- Bug fixes: `bug/<issue#>-<short-slug>`.
- Branch from `main`. PR body includes `Closes #<n>`. Keep a branch inside one service folder where possible.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if external PRs should enter the triage queue; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a GitHub issue following the title/label conventions above.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`, and also read its parent requirement (the title with the last `.n` dropped).

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: an issue labelled `wayfinder:map` holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: a GitHub sub-issue of the map (`gh api` sub-issues endpoint); fall back to a task list in the map body plus `Part of #<map>` at the top of the child. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Assign to the driving dev once claimed.
- **Blocking**: native issue dependencies: `gh api --method POST repos/AY2627S1-CS3219-P27/FoC/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` (database id via `gh api repos/AY2627S1-CS3219-P27/FoC/issues/<n> --jq .id`). Fall back to a `Blocked by: #<n>` line.
- **Frontier query**: the map's open children with no open blocker and no assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, `gh issue close <n>`, then append a pointer to the map's Decisions-so-far.
