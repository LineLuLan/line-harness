---
name: handoff
description: "Write a session-continuation handoff file at .handoff/handoff-<DD-mon-YYYY>-<HHMM>.md before context compact, session close, or end-of-work. The SessionStart hook auto-loads the newest one so the next session resumes without re-reading the whole transcript. Auto-triggers on slash commands /handoff, /clear, /pack, /save, or natural phrases like 'pack up', 'wrap up', 'save state', 'compact protocol', 'save credits', 'going to sleep', 'before /compact'."
verified: 2026-08
layer: utility
category: workflow
triggers: ["/handoff", "/clear", "/pack", "/pack-up", "/save", "/save-state", "/wrap", "/wrap-up", "/sleep", "pack up", "pack this up", "wrap up", "wrap this up", "save state", "save the state", "handoff", "make a handoff", "compact protocol", "before compact", "before /compact", "before quitting", "save credits", "save tokens", "going to sleep", "imma sleep", "i'm going to sleep", "end of session", "session end", "close session"]
---

# Handoff — write a session-continuation file

When the user signals end-of-session (any trigger above) OR you notice the
conversation is about to compact (long context, near a known compact point),
write `.handoff/handoff-<DD-mon-YYYY>-<HHMM>.md` at the repo root **before**
anything else happens.

This file is auto-loaded by `.claude/hooks/handoff-load.sh` on the next session
start, so the next agent (Claude or codex) resumes from your **Next step**
without re-reading the whole transcript.

## How to write one

1. **Get the timestamp**: run `date "+%-d-%b-%Y-%H%M" | tr '[:upper:]' '[:lower:]'`
   → use that as the filename suffix. Example: `handoff-14-may-2026-2308.md`.

2. **Make sure the dir exists**: `mkdir -p .handoff` (it's gitignored — purely
   local working state, never committed).

3. **Write the file** using the **Write** tool. The file MUST contain these
   six sections in this order:

   ```markdown
   # Handoff — <YYYY-MM-DD HH:MM Day>

   ## What we're building
   <one paragraph naming the overall target of the work>

   ## Current state
   <one paragraph: what's done / deployed / pushed / running locally>

   ## Files in flight
   <bullet list of uncommitted edits with a short note each — run
    `git status --short` to populate>

   ## What changed this session
   <bullet list of commits made + significant edits, oldest-first.
    Run `git log @{u}..HEAD --oneline` or pick a sensible cutoff>

   ## What failed and why
   <bullet list of things attempted that didn't work, with root cause.
    Stops future-you from repeating the same trap>

   ## Next step
   <ONE concrete action the next session should try first. Not a list.
    The single thing>
   ```

   Optional: a final `## Open questions` section for things the user asked
   that aren't blocking.

4. **Confirm to the user** in one short sentence — e.g. *"Handoff at
   .handoff/handoff-14-may-2026-2308.md — next session auto-resumes from
   the Next step."* Don't print the file contents back; the user wrote
   them with you and reading it on disk if they want is faster.

## When to refuse / negotiate

- **If the user signals a different intent** — e.g. they said "pack up" but
  meant something else — ask before writing. The skill should err toward
  acting, but a 5-second confirmation is fine if it's ambiguous.
- **Don't double-write**: if you wrote a handoff earlier in the same session
  and nothing significant has changed, update the existing file's content
  via Edit rather than creating another timestamp.
- **Don't write trivially small handoffs**: if the session did nothing
  load-bearing, just say so to the user instead of creating noise.

## Things to NOT put in a handoff

- Secrets — `.handoff/` is gitignored but rsync / backup tools may still pull
  it; treat as low-trust storage.
- Raw command output, full file dumps — reference by `path:line` instead.
- The entire conversation transcript — just the load-bearing decisions and
  the things that broke.
- > 200 lines total — that's a session log, not a handoff. Compress.

## Verification before saying done

After Writing:
- `ls -la .handoff/` to confirm the file exists
- Confirm it's gitignored: `git check-ignore .handoff/handoff-*.md`
  should print the path (file is ignored) — if it prints nothing, the
  `.gitignore` entry is broken and you need to fix it.

## Why this exists

Context resets (compact, new session, agent quit) lose state. Re-reading a
1000-message transcript to recover is expensive in tokens AND time. The
handoff is a 100-line summary that costs ~2k tokens to load and replaces
the whole "where were we?" exchange. See `CLAUDE.md` → "Handoff Protocol"
for the full spec.
