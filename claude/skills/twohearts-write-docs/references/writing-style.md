# Writing Style — Plain Language (ASD-STE100-inspired)

The goal: a QA member, a product person, or a new dev reads the document once and knows what
to do. Low-tech wording, full detail. These rules adapt the ideas of ASD-STE100 (Simplified
Technical English) for TwoHearts docs in Vietnamese or English.

## Sentence Rules

- Keep sentences short: about 20 words for instructions, about 25 for descriptions. If a
  sentence needs a second breath, split it.
- One instruction per sentence. One topic per paragraph. Paragraphs of 6 lines or fewer.
- Use the active voice and name the actor: "QA resets the tenant", not "the tenant is
  reset". The reader must always know **who** does the action.
- Use the same word for the same thing everywhere. Do not alternate synonyms (pick one of
  "release/promotion", "sign-off/approval" per doc and keep it).
- Give each technical term a one-line definition the first time it appears, then reuse the
  term. Do not assume the reader knows "RLS", "squash", or "idempotency".
- Prefer verbs over noun chains: "when you change the schema", not "upon schema change
  execution".
- Avoid vague words: "quickly", "properly", "as needed", "handle". Say what, when, and how
  much.

## Structure Rules

- Procedures are numbered steps. One action per step. Sub-steps only one level deep.
- Warnings and conditions come **before** the action they affect: "If the suite is red, do
  not merge. Merge only fixes or reverts."
- Use a table when the reader must compare or look things up; use prose when the reader must
  understand a reason. Never bury a rule inside a long paragraph.
- Every doc opens with: what this doc is, who it is for, and what the reader will be able to
  do after reading it.
- End procedures with the observable result: "Done looks like: the tag exists on `main` and
  the changelog has a new entry."
- Examples are real: use actual command lines, actual file paths, actual field names from
  the repos — never invented ones.

## Completeness Check (before shipping)

Ask these five questions; the doc ships only when all are yes:

1. Can a reader outside the team follow this without asking anyone?
2. Does every instruction say who acts, what they do, and what proves it worked?
3. Are all failure paths covered ("what if it is red / blocked / missing")?
4. Is every rule traceable to a policy source (or clearly marked as guidance)?
5. Did you read it once aloud without stumbling? If you stumble, the reader stumbles.

## What To Avoid

- Walls of text with rules hidden inside.
- Ten-dollar words where a one-dollar word works ("utilize" → "use"; "prior to" → "before").
- Screenshots of text (they cannot be searched or diffed) — paste the text.
- Duplicating a policy's content: link and summarize in one line instead, so there is one
  source of truth to maintain.
- Humor, idioms, and culture-specific references in procedure text — they do not translate.
