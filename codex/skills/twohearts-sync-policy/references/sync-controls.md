# Policy Sync Controls

## Source Controls

- `TH-SYNC-001`: Canonical policy sources are inventoried by SHA-256, size, and timestamp.
- `TH-SYNC-002`: Policy drift is reported without updating the stored baseline.
- `TH-SYNC-003`: Every declared control exists in its owning skill.
- `TH-SYNC-004`: Skill validation and UI metadata consistency are checked after changes.

## Interpretation

A hash change means the source must be reviewed; it does not prove policy semantics changed.
A timestamp-only change is informational when content hash and size remain stable.

Coverage validation proves declared control markers are present in the expected skill. It does
not prove the prose implements policy correctly, so meaningful changes still require human or
independent-model review against the canonical sources.

The proposal file is not in the policy manifest because it is architecture guidance rather
than policy authority.
