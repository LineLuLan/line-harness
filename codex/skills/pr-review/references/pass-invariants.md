# Pass Invariants

## Triage Tier

Record the tier before review starts. Derive it from the pass triggers below.

| Tier | Rule |
| --- | --- |
| Critical | The diff touches money, tenant boundaries, authentication, or migrations |
| High | The diff touches a backend-consumer contract, or the PR is large |
| Standard | No trigger fires |

## Blind Rule

Passes run blind to each other. Run each pass in a fresh context. Merge results during synthesis. State each pass as an invariant, not a mechanism.

## Passes

### 1. Correctness - Always Runs

- The behavior matches the stated intent, or the mismatch is a recorded finding.
- Every edge case in changed logic has a defined outcome.
- A crash during an operation leaves no partially written state.
- The pass states which interpretation it reviews when the description and diff disagree.

### 2. Standards - Always Runs

- Every citation points to a written repository rule. Cite written rules only.
- When no rule covers an area, emit `no written standard covers this`. Never invent policy.
- A missing standard never excuses a real defect.

### 3. Tenant And Security - Runs When The Diff Touches Tenant Or Security Surfaces

- Every query on a tenant-owned table carries the tenant scope.
- No code path returns one tenant's data to another tenant.
- No secret, token, or credential enters logs, responses, or the diff.
- Authentication and authorization checks run before the action on every changed route.

### 4. Money Integrity - Runs When The Diff Touches Payments, Vouchers, Prices, Or Totals

- A crash and retry causes no duplicate charge.
- Amounts remain integer minor units end to end.
- Every voucher and discount path yields the same total on recomputation.
- No money state advances without corresponding payment evidence.
- Each line is priced from the authoritative catalogue for the transaction context. Treat caller-supplied price fields as untrusted input.
- The outbound total matches the persisted approved total at the submission boundary. Block submission on mismatch.
- Authorized overrides and non-catalogue fees use a documented path that records the override.

### 5. API Contract - Runs When The Diff Touches A Backend-Consumer Contract

- Every changed response shape has a consumer that accepts it.
- Previously deployed consumers tolerate new backend responses during rollout.
- Removed or renamed fields have no remaining consumer.
- Error responses retain the shape that consumers parse.
- Effective feature defaults include deployment-environment overrides, not only source defaults.
- Consumers support renamed events before a new event name or default is deployed.
- Every channel that emits a changed event is enumerated and reviewed.

### 6. Test Adequacy - Runs For Large Or Critical PRs

- Every new danger-surface path has a test that fails when the behavior breaks.
- Changed tests still assert the original behavior, or the change is a recorded finding.
- No assertion was deleted and no threshold was weakened without a recorded reason.

## Merge Safety - Runs When The Merge Result Needs Manual Or Non-Trivial Conflict Resolution

- Diff both sides of each conflicting file.
- Fixes introduced independently on the target survive the merge.
- Verify the three-way result, not only the head version.
- A forward merge never reverts target work.

## Migration Checklist

Check these items on every migration:

- Destructive SQL.
- Long table locks.
- Compatibility while old code runs against the new schema during a rolling deployment.
- Tenant scope.
- Integer-minor-unit precision in money data migrations.
