# Open Policy Decisions

Report these as `OPEN POLICY DECISION` when they materially affect a task. Do not encode a
local preference as policy.

1. Machine-readable issue approval state or accepted approval phrase.
2. Exact AI thresholds, allowed variance, judge protocol, and stability definition.
3. Whether a hotfix release gets its own tag/changelog entry (the hotfix execution path itself
   is settled policy).
4. Exact GitHub rulesets and required check names.
5. Whether `blocked` (external outage) on a core QA flow blocks release — a ❌ failure
   definitely blocks.
6. Safe contract for live external-provider and payment tests.
7. Canonical source and version for the shared `pr-review` skill (the obligation to run it is
   settled; only its source is open).
8. Which target controls are effective in each repository.
9. Definition of a crucial midweek request (the default — queue for next sprint — is settled).
10. Automated-test ownership for Mission Control (manual QA scope is settled: Mission Control
    is not QA scope).
11. Official policy precedence where approved sources conflict.
12. Whether idempotency-for-side-effects is promoted to a formal TwoHearts hard gate (owner
    approval required for promotion).

## Fail-Closed Rule

- Continue read-only discovery and safe local planning where possible.
- Stop before any action whose correctness depends on an unresolved decision.
- Identify the missing owner decision, evidence, or runbook.
- Do not substitute generic skill defaults.
