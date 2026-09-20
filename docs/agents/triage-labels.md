# Triage Labels

These labels exist so that **issues raised by agents are uniform**. Every issue an agent creates gets the same shape as the seeded backlog (see `issue-tracker.md`) plus exactly one triage label below. Issues a dev raises and names themselves are theirs; don't retitle, relabel or triage them.

The seeded backlog has no triage labels; it is classified by its Sprint and Priority fields instead. Skills must handle both.

## Raising an issue (agents)

1. Title and body: follow "Issue conventions" in `issue-tracker.md`.
2. One `module.*` label.
3. One triage label from the table (usually `needs-triage`).
4. Never set Sprint or Priority; a human does that.

## Labels

| Role | Label | Meaning | Seeded issues (no label) |
| --- | --- | --- | --- |
| Needs triage | `needs-triage` | Agent-raised; a human must set Sprint and Priority | Sprint or Priority unset |
| Needs info | `needs-info` | Waiting on the team for more information | n/a |
| Ready for agent | `ready-for-agent` | Fully specified, an agent can implement it | Sprint and Priority set, sprint is current or earlier, no `needs-info` / `ready-for-human` / `wontfix` |
| Ready for human | `ready-for-human` | Requires human implementation | n/a |
| Won't fix | `wontfix` | Will not be actioned (label already exists) | n/a |

When picking work, order by Priority (`Urgent` > `High` > `Medium` > `Low`), then Sprint.

`Refinement Level` (1-3) is not used for triage; its meaning is undocumented.
