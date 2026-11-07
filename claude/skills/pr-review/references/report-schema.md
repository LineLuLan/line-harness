# Report Schema

## Finding Fields

Every reported finding carries these five fields.

| Field | Allowed values |
| --- | --- |
| Impact | Blocker / High / Medium / Low |
| Disposition | Must-fix / Fix-later / Nit |
| Confidence | Confirmed / Likely / Question |
| Discovery | How the review found it |
| Reproduction | How to reproduce it |

Rules:

- A finding cannot be Must-fix without verification.
- Verify every Blocker, every High, and every Must-fix at any impact level.
- Report other Medium and Low findings as unverified with their confidence labels.
- Record the risk that an unverified non-Must-fix Medium finding can hide a misclassified High finding.

## Verdict Rules

| Verdict | Rule |
| --- | --- |
| REQUEST CHANGES | At least one Confirmed Must-fix |
| APPROVE | Zero Must-fix findings |
| COMMENT | The review could not complete |

- A broken review never approves.
- Massive-defect precedence: a massive defect with an early stop produces `REQUEST CHANGES` and the flag `deep review not complete`. The report must not claim that unreviewed areas are good.
- The verdict binds to the head SHA, target SHA, and merge base. New commits or target drift invalidate it. Recheck all SHAs immediately before posting.

## Report Template

```text
VERDICT: <REQUEST CHANGES | APPROVE | COMMENT> - head <sha>, target <sha>, merge base <sha>
[Flag if present: deep review not complete]

FINDINGS (worst first):
1. <title>
   Impact: <value> | Disposition: <value> | Confidence: <value>
   Discovery: <how the review found it>
   Reproduction: <how to reproduce it>
   [Lesson: <ID> if an active lesson found it]

WHAT HOLDS:
- <good parts that the review confirmed>

REPAIR ORDER:
1. <fix this first>
2. <then this>

PROPOSED LESSONS:
- <proposals for the CTO; none activate without CTO approval>
```

Do not report items already recorded on the PR's deferred list.

A defect is pre-existing only when it reproduces on the current target SHA in the same environment. A file outside the diff is a signal, not proof; changed shared code can break untouched files. Prove the defect at the target SHA before calling it pre-existing. Report a proven pre-existing defect as context or Fix-later. Never make it a Must-fix against the current author.

## STE Writing Rules

- Write short sentences with one instruction per sentence.
- Use active voice and imperative mood.
- Use one term for one concept. Do not vary terms for style.
- State facts and measurements. Do not soften or pad.
