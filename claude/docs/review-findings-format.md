# Review findings format

Paste this contract into Fable, Codex or supervisor review prompts.

After the VERDICT line, append one fenced block with the exact lowercase info string `findings`. Put a JSON array inside it. Use `[]` when there are no findings. Do not add prose inside the array. The final closed `findings` block wins if more than one is present. Other code fences, including examples inside a larger fence, are ignored. An unclosed fence is not a block.

Every array item must be an object with all five fields below. Field names and enum values are case-sensitive. Extra fields are ignored and are not written to the facts log.

| Field | Allowed value |
| --- | --- |
| `severity` | String: `P0`, `P1`, `P2` or `P3`. |
| `category` | Exact lowercase ontology id from the table below. Unknown ids are invalid. |
| `title` | Nonblank string, at most 200 characters. |
| `location` | String or JSON `null`. Use a file and line when known. |
| `criterion` | String matching `^C[0-9]+$`, such as `C2`, or JSON `null`. |

P0 blocks shipping due to wrong results, data loss or security defects. P1 must be fixed before merge. P2 should be fixed. P3 is a nit. Declare the category and criterion explicitly. Do not rely on tags or prose to supply them.

## Categories

These ids and labels come from `ontology/harness.ontology.json`, checked 2026-11-15.

| Id | Label |
| --- | --- |
| `contradiction` | Contradictory requirements |
| `sandbox-validate` | Sandbox validation |
| `salvage-resume` | Salvage and fresh sessions |
| `ui-widths` | UI width coverage |
| `docs-style` | Documentation style |
| `encoding` | File encoding |
| `docs-sync` | Documentation synchronization |
| `source-of-truth` | Source of truth |
| `concurrency` | Concurrency and ordering |
| `fixture-secret` | Fixture secret gates |
| `real-path` | Real execution path |
| `formatter-lint` | Formatter and static checks |
| `env-tools` | Environment and tools |
| `scope-creep` | Scope control |
| `ps51-traps` | PowerShell 5.1 traps |
| `missing-criterion` | Missing success criterion |
| `unverified-claim` | Unverified completion claim |
| `logic-bug` | Logic defect |
| `other` | Other defect |

## Two findings

VERDICT: FAIL
```findings
[
  {
    "severity": "P1",
    "category": "scope-creep",
    "title": "The change writes outside the approved directory",
    "location": "src/write.ps1:42",
    "criterion": "C2"
  },
  {
    "severity": "P2",
    "category": "encoding",
    "title": "The exported text has an unexpected byte order mark",
    "location": null,
    "criterion": null
  }
]
```

## No findings

VERDICT: PASS
```findings
[]
```

## Validation and ingestion

`Get-StructuredFindings -Text <text> [-Ontology <category-id-array>]` returns `Status`, `Findings`, `Violations`, and `InvalidIndexes`. `Violations` is the number of invalid items. `InvalidIndexes` lists their zero-based positions in the original JSON array.

- `ok`: the block is a JSON array. Invalid items are dropped and counted; valid items are returned. An empty array is valid.
- `missing`: no closed findings fence exists.
- `invalid`: the selected block cannot be parsed as JSON or its root is not an array.

`codex-review.ps1` writes each valid item with `kind: finding` and `quote: null`. For a nonempty model answer, a missing or invalid block, or any invalid items, adds one layer-2 `format-violation` row. Its severity is null and its category is `other`. These rows leave the review verdict and exit code unchanged.

`finding-add.ps1 -FromFile` writes valid items with `kind: finding` and `quote: null`. Invalid item indexes are printed on stderr and the command exits 1. A missing or invalid block exits 1 without writing. A file containing only `VERDICT: PASS` is therefore an error. An explicit `[]` succeeds without writing.
