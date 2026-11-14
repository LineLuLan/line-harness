| Tier | Layers |
| --- | --- |
| Skip (under ~20 lines of config, typo, docs) | 3 |
| Standard-A / Standard-B | 1 + 3 (`codex-review.ps1 -SkipModel`); layer 2 optional over ~150 lines, logged |
| Important (multi-file, API contract, shared module) | 1 + 2 (`gpt-6-astra`, mandatory) + a Fable 5.1 subagent + 3 |
| Critical (security, payment, auth, migration) | Important + Line approves in writing |