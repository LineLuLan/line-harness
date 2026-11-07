#!/usr/bin/env python3
"""Print a read-only inventory of canonical TwoHearts policy files."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_MANIFEST = Path(__file__).resolve().parent.parent / "references" / "policy-manifest.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--policy-dir", type=Path)
    args = parser.parse_args()

    try:
        manifest = load_manifest(args.manifest)
        policy_dir = args.policy_dir or Path(manifest["default_policy_dir"])
        if not policy_dir.is_dir():
            raise FileNotFoundError(f"Policy directory not found: {policy_dir}")

        files = []
        for expected in manifest["files"]:
            path = policy_dir / expected["name"]
            if not path.is_file():
                raise FileNotFoundError(f"Policy file not found: {path}")
            stat = path.stat()
            files.append(
                {
                    "name": expected["name"],
                    "sha256": sha256(path),
                    "size": stat.st_size,
                    "modified_utc": datetime.fromtimestamp(
                        stat.st_mtime, tz=timezone.utc
                    ).isoformat(),
                }
            )
        print(json.dumps({"policy_dir": str(policy_dir), "files": files}, indent=2))
        return 0
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "error", "error": str(error)}, indent=2))
        return 2


if __name__ == "__main__":
    sys.exit(main())
