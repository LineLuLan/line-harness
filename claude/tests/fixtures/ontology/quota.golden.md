| Codex quota | Route |
| --- | --- |
| Pace <= 1.0 and used < 70% | Normal routing table. |
| Pace > 1.0 to 1.3, used 70-84%, or over daily budget | Standard-B with <= 3 files and a runnable VALIDATE goes to `gpt-6-sol` high. No Luna exploration (Claude Explore subagent). Layer 2 = Fable subagent. |
| Pace > 1.3 or used 85-94% | Codex for Important/Critical. Standard work goes to an Opus subagent with the same packet (if Claude is stressed too, see below). No resumes. |
| Used >= 95% | No Codex. Opus subagent = worker, Fable subagent = layer 2, ledger `worker=opus`. |

- Claude 7-day pace > 1.2 or used >= 70%: no Opus subagent workers; layer 2 = Astra; Fable only for Critical layer 3; supervisor edits <= 20 lines.
- Both sides stressed (Claude rule above active and Codex not >= 95%): Standard-A and Standard-B go to `gpt-6-sol` high and are never deferred (Line, 2026-11-15).
- Codex used >= 95% while the Claude rule is active: no new packets; report to Line. This is the only stop rule.
- Claude 5-hour used >= 80%: finish the current check, update the handoff, pause Claude work until the window resets.
- Codex desktop and CLI sessions count against the budget. One session over 50M tokens: stop and report to Line.