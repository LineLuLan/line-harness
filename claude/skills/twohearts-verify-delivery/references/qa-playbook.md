# QA Weekly Pass (per QA_PLAYBOOK.md)

Load this reference only for QA drafting, QA evidence, or release-gate assessment.

## Scope

- QA is the human judgment layer on top of automated tests: what a real customer and a real
  staff member see.
- Three surfaces: customer ordering website, Messenger AI chat, staff dashboard.
  **Mission Control is not QA scope.**
- Two devices: one desktop browser and one phone. Critical flows run on both; the rest runs on
  the device customers mostly use.
- QA does no terminal, no code, no test-writing; coverage lives in the issue specs. No
  production testing unless explicitly asked (a short post-release smoke may be requested).

## Weekly Pass

Runs on a fixed day, 1-2 days before the weekly `dev -> main` release. QA sign-off is one of
the three release gates. Two parts:

1. **Standing regression script** — the fixed core journeys, run every week (not AI-drafted):
   - Website order → appears on dashboard → kitchen flow → invoice.
   - Messenger chat order → draft → confirm → invoice.
   - Voucher use.
   - Address entry, including post-reform Vietnam wards.
   - Payment: full cycle (pay → order marked paid → invoice correct), plus cancel and failure
     paths.
2. **Sprint delta script** — this week's new features as click-by-click steps. An AI agent
   drafts it from the sprint issues; **the feature's dev approves it before handoff to QA.**

Plus 15 minutes of free exploration each pass; observations are filed separately from script
failures.

The QA test tenant is reset and reseeded before every pass. Each script step states its
starting data. **If a step failed, capture the screenshot BEFORE anything is reset.**

## Filing Bugs

Use the "QA Bug" GitHub issue form. Fields: script step that failed; status
(failed / blocked / intermittent); what you expected (pre-filled from the script); what
happened; screenshot or recording when possible; device and surface; order ID or conversation
ID if available. **Do not guess severity — devs triage.** "Blocked" means an outside system
stopped you; blocked is not a pass and not a fail.

## Sign-off

One page: each flow ✅/❌/blocked with bug links. All green = release gate passed. A ❌ on a
core flow blocks the release, same as a red test suite. Only [founder] can waive a failure, with
one written line: reason + expiry + linked issue.

Occasional feature testing outside the weekly pass uses the same click-by-click format with no
standing obligation.
