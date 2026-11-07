# Verification Controls

## Source Controls

- `TH-VER-001`: Issue scenarios map to tests, review evidence, and QA steps.
- `TH-VER-002`: Verification uses commands and thresholds discovered in the active repo.
- `TH-VER-003`: Tenant-scoped changes include tenant-isolation regression evidence.
- `TH-VER-004`: AI evaluation distinguishes deterministic and scored layers and does not invent
  thresholds.
- `TH-VER-005`: Red `dev` is classified; tests are not silently disabled.
- `TH-VER-006`: QA sign-off comes from authorized human evidence, not Codex inference.
- `TH-VER-007`: Completion language distinguishes executed, static, and missing verification.
- `TH-VER-008`: Every PR must have unit tests, integration tests, and the scripted AI flows all
  green to merge; PRs touching prompt or model files additionally require the promptfoo check.
- `TH-VER-009`: Critical flows (placing an order, payment, consent) have zero tolerance in AI
  evaluation — one failure blocks.
- `TH-VER-010`: An internal red `dev` freezes `dev` (only fixes or reverts merge until green);
  if the cause cannot be identified within 1 hour, revert the suspect merge.

## The Five Test Layers (per DEV_TESTING.md §6)

| Layer | Scope | Tooling | When it runs |
|---|---|---|---|
| 1 | API-flow E2E | Vitest + staging harness (live externals, harness-test tenant, run-ID isolation, pre-flight health check) | Merge-to-dev + daily cron |
| 2 | Scripted-LLM flows | Vitest + scenario-runner/emulator | Per-PR CI + daily cron |
| 3 | Live-model sims | LangWatch Scenario, personas from convo corpus, judge per flow | Nightly 50 / pre-release 400; the 400 thresholds gate weekly promotion |
| 4 | Prompt/model changes | promptfoo matrix + red-team suite | Required check on PRs that touch prompt/model files |
| 5 | Production feedback | Langfuse datasets from misbehaving real conversations | Continuous; feeds layers 3-4 |

The staging harness uses its own test tenant, isolated run IDs, and a pre-flight health check
that separates "staging is down" from a real failure. The QA tenant is separate from the
harness tenant; automation resets and reseeds it before each QA pass.

Do not call a generic local test pass release-ready when tenant, AI, weekly automation, or QA
gates remain applicable and unproven.

## PR And Local Gates

- Every PR: unit tests, integration tests, and the scripted AI flows — all green to merge.
- Prompt/model file changes: the promptfoo check also runs and is required.
- Locally before opening a PR: `pnpm typecheck && pnpm lint && pnpm test`; the staging harness
  can be run from the branch for a full real-world check (same suite as the daily run).
- The issue already lists the test scenarios; the tests must prove them.

## How AI Tests Are Judged

- Software tests are exact: pass or fail. AI conversation tests are scored against thresholds.
  Do not mix the two — assert on effects (order created, tool called, consent state), never on
  exact AI wording.
- Critical flows (placing an order, payment, consent): zero tolerance. One failure blocks.
- Conversation quality: scored with an accepted variance; a small dip is a signal, not a block.
- Scenarios, judge prompts, and scoring rules are versioned together. When the model provider
  drifts, compare against the baseline before blaming the code.
- Do not invent the 50/400 threshold details, judge model, variance, or stability definition
  where the repo does not define them. Verify sandbox/test mode before any provider or payment
  test.

## Red Dev (daily suite red)

Check first: our bug, or an outside system down (staging, Facebook, a vendor)?

- Our bug → **`dev` is frozen. Only fixes or reverts merge until green.** Whoever broke it
  fixes it. Reverting is always fine.
- Outside system → record as blocked with an owner and an expiry date. No freeze. Never
  silently disable a test.
- **Cannot tell after 1 hour → revert the suspect merge.**

Red must stay an emergency; when red becomes normal, new breakage hides inside it. A ❌ on a
core QA flow blocks the release the same as a red test suite ("blocked" is not a pass and not
a fail — see the QA reference).
