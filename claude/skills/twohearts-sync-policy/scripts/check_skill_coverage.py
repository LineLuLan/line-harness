#!/usr/bin/env python3
"""Validate declared TwoHearts control markers in their owning skills."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


DEFAULT_COVERAGE = Path(__file__).resolve().parent.parent / "references" / "control-coverage.json"
DEFAULT_SKILLS_DIR = Path.home() / ".codex" / "skills"


def markdown_text(skill_dir: Path) -> str:
    parts = []
    for path in sorted(skill_dir.rglob("*.md")):
        parts.append(path.read_text(encoding="utf-8"))
    return "\n".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--coverage", type=Path, default=DEFAULT_COVERAGE)
    parser.add_argument("--skills-dir", type=Path, default=DEFAULT_SKILLS_DIR)
    args = parser.parse_args()

    try:
        with args.coverage.open("r", encoding="utf-8") as handle:
            coverage = json.load(handle)
        if not args.skills_dir.is_dir():
            raise FileNotFoundError(f"Skills directory not found: {args.skills_dir}")

        cache: dict[str, str] = {}
        failures = []
        for control in coverage["controls"]:
            control_id = control["id"]
            owner = control["owner_skill"]
            skill_dir = args.skills_dir / owner
            if not (skill_dir / "SKILL.md").is_file():
                failures.append(
                    {"id": control_id, "owner_skill": owner, "reason": "owner_skill_missing"}
                )
                continue
            if owner not in cache:
                cache[owner] = markdown_text(skill_dir)
            if control_id not in cache[owner]:
                failures.append(
                    {"id": control_id, "owner_skill": owner, "reason": "control_marker_missing"}
                )

        status = "incomplete" if failures else "ok"
        print(
            json.dumps(
                {
                    "status": status,
                    "skills_dir": str(args.skills_dir),
                    "controls_checked": len(coverage["controls"]),
                    "failures": failures,
                },
                indent=2,
            )
        )
        return 1 if failures else 0
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "error", "error": str(error)}, indent=2))
        return 2


if __name__ == "__main__":
    sys.exit(main())
