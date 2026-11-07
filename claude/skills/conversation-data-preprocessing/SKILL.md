---
name: conversation-data-preprocessing
description: Clean and transform real company conversations, including company conversation logs, into training-ready, fine-tune-ready, eval-ready, RAG-ready, or customer-intelligence-ready datasets. Use for preprocessing raw conversation logs, removing noise, redacting PII, normalizing Vietnamese/English/mixed language, extracting intents/entities/tool targets, labeling outcomes, deduplicating, sessionizing, splitting data safely, creating real-world cases, and versioning cleaned datasets for model learning.
verified: 2026-08
---

# Conversation Data Preprocessing

Use this skill before training, fine-tuning, eval creation, RAG indexing, or customer memory from
real customer conversations.

## Pipeline

1. Inventory sources: chat exports, CRM notes, order logs, tool traces, support tickets, call
   transcripts, menu/catalog references, and customer metadata.
2. Define target use: fine-tune, classifier training, retrieval corpus, eval set, memory facts,
   prompt examples, or failure-case library.
3. Parse and sessionize:
   - Preserve speaker roles, timestamps, channel, order/session/customer IDs, and language.
   - Join tool traces and order outcomes when available.
   - Split long conversations into coherent episodes without breaking an order flow.
4. Clean:
   - Remove boilerplate, duplicated messages, system artifacts, export markup, emojis only when
     irrelevant, broken encoding, and empty turns.
   - Normalize whitespace, casing where appropriate, Vietnamese diacritics strategy, abbreviations,
     menu item aliases, phone/address formats, and mixed VI/EN patterns.
   - Redact or transform PII: phone, address, names, payment info, tokens, credentials, private notes.
5. Label:
   - Intent, language bucket, entities, expected tool, expected answer, resolution outcome, failure
     type, sentiment/complaint, escalation need, and business value.
   - Mark uncertain labels explicitly instead of forcing false certainty.
6. Split and version:
   - Split by customer/session/order to prevent leakage.
   - Keep raw, cleaned, labeled, train, validation, test, and holdout versions traceable.
   - Save data dictionary, label guide, and known caveats.

## Quality Gates

- No secret or sensitive PII leakage in cleaned/training/eval outputs.
- Label agreement or review process exists for important classes.
- Distribution covers real-world cases: slang, typos, no diacritics, mixed language, complaints,
  menu ambiguity, address/phone noise, tool-required turns, and failed orders.
- Evaluation holdout is never used for prompt tuning or training.
- Every derived sample links back to a source ID without exposing raw PII.

## Output Shape

```markdown
## Dataset Purpose
[Training / fine-tune / eval / RAG / memory]

## Source Inventory
[Conversation sources and joins]

## Cleaning Rules
[Normalization, redaction, dedup, sessionization]

## Label Schema
[Fields, definitions, uncertainty handling]

## Split Strategy
[Leakage controls and versioning]

## Quality Report
[Counts, rejection rate, gaps, risks]
```

## Worked Example

Raw VI/EN order conversation:

```text
customer: cho minh 2 ca phe sua, one ít đá. giao 12 Nguyen Trai, 0900000000
agent: Ok bạn, 2 milk coffee, one less ice. Tổng 70k. Confirm?
customer: yes giao 9am nhé
```

Training row after normalization, redaction, and labeling:

```json
{
  "source_id": "src-1042",
  "language": "vi-en",
  "input": "Cho mình 2 cà phê sữa; một ly ít đá. Giao [ADDRESS] lúc 09:00. SĐT [PHONE].",
  "target": "Xác nhận 2 cà phê sữa, một ly ít đá, giao lúc 09:00. Tổng giá cần được công cụ đơn hàng xác nhận.",
  "intent": "place_order",
  "entities": { "item": "ca_phe_sua", "quantity": 2, "modifier": "one_less_ice" },
  "expected_tool": "create_order",
  "outcome": "pending_confirmation",
  "pii_redacted": true,
  "label_confidence": 0.96
}
```

Split this row by its source customer/session/order group, never by message, to prevent leakage.
