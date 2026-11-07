# Lessons

Lessons are structured records, not prose. A review run can propose a lesson in its final report. Only the CTO activates a lesson by editing this file. Future runs load only active lessons that match the repository and triggered danger surfaces. Reports cite lesson IDs when a lesson finds a problem. Keep tombstones so removed lessons cannot return.

## What Belongs Here

A lesson records repository-specific knowledge or a hypothesis that still needs evidence. General engineering knowledge belongs in the permanent pass checks. Promote a lesson when it matures.

## Graduation And Pruning

- Count exposures, not only hits. An exposure is a run where the trigger fired.
- Promote a lesson into a permanent check after two confirmed catches in different PRs, across at least five exposures, with at most one false alarm.
- The CTO may promote a cheap deterministic check immediately when it guards a Blocker-class hazard.
- Reassess every six weeks or every 30 PRs.
- Cap active lessons at three per surface. Rank them by severity, evidence, and recent use. Move overflow to dormant.
- Tombstone only a lesson that is disproved, superseded, or promoted. Record the reason and replacement check.
- Never prune a rare catastrophic control because it did not fire.

## Record Fields

| Field | Meaning |
| --- | --- |
| ID | Stable identifier |
| Status | active / proposed / tombstone |
| Repositories/surfaces | Affected repositories and danger surfaces |
| Trigger | When the lesson loads |
| Invariant | The invariant to check |
| Source | Evidence source |
| Proposer | Role that proposed it |
| CTO approver | CTO approval record |
| Dates | Proposal and approval dates |
| Hit counts | Useful-hit count / false-alarm count |
| Supersedes | Lesson ID this record replaces |

## Active Lessons

| ID | Status | Repositories/surfaces | Trigger | Invariant | Source | Proposer | CTO approver | Dates | Hit counts | Supersedes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L-1 | tombstone (promoted) | all repositories / merge safety | - | The permanent merge-safety check in `pass-invariants.md` supersedes this lesson. Do not reactivate it as repository-specific knowledge. | Promoted control | Review process | CTO | `<promotion-date>` | - | - |
