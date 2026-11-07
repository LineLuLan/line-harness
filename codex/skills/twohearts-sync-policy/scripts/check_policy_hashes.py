#!/usr/bin/env python3
"""Compare canonical TwoHearts policy files with the stored read-only manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


DEFAULT_MANIFEST = Path(__file__).resolve().parent.parent / "references" / "policy-manifest.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--policy-dir", type=Path)
    args = parser.parse_args()

    try:
        with args.manifest.open("r", encoding="utf-8") as handle:
            manifest = json.load(handle)
        policy_dir = args.policy_dir or Path(manifest["default_policy_dir"])
        if not policy_dir.is_dir():
            raise FileNotFoundError(f"Policy directory not found: {policy_dir}")

        drift = []
        for expected in manifest["files"]:
            path = policy_dir / expected["name"]
            if not path.is_file():
                drift.append({"name": expected["name"], "reason": "missing"})
                continue
            actual_hash = sha256(path)
            actual_size = path.stat().st_size
            if actual_hash != expected["sha256"] or actual_size != expected["size"]:
                drift.append(
                    {
                        "name": expected["name"],
                        "reason": "content_changed",
                        "expected_sha256": expected["sha256"],
                        "actual_sha256": actual_hash,
                        "expected_size": expected["size"],
                        "actual_size": actual_size,
                    }
                )

        status = "drift" if drift else "ok"
        print(json.dumps({"status": status, "policy_dir": str(policy_dir), "drift": drift}, indent=2))
        return 1 if drift else 0
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "error", "error": str(error)}, indent=2))
        return 2


if __name__ == "__main__":
    sys.exit(main())
