from __future__ import annotations

import argparse
import hashlib
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def assert_integrity(path: Path) -> None:
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
        result = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise RuntimeError(f"SQLite integrity_check failed: {result}")


def backup_database(database: Path, output_dir: Path) -> tuple[Path, Path]:
    if not database.is_file():
        raise FileNotFoundError(f"database not found: {database}")
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    destination = output_dir / f"{database.stem}-{stamp}.db"
    source = sqlite3.connect(database)
    target = sqlite3.connect(destination)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    assert_integrity(destination)
    checksum = destination.with_suffix(destination.suffix + ".sha256")
    checksum.write_text(
        f"{sha256(destination)}  {destination.name}\n",
        encoding="utf-8",
    )
    return destination, checksum


def verify_checksum(backup: Path, checksum: Path) -> None:
    expected_line = checksum.read_text(encoding="utf-8").strip()
    parts = expected_line.split()
    if len(parts) != 2 or parts[1] != backup.name:
        raise RuntimeError("checksum file does not identify the selected backup")
    actual = sha256(backup)
    if actual != parts[0]:
        raise RuntimeError("backup SHA-256 mismatch")


def restore_database(
    database: Path,
    backup: Path,
    checksum: Path,
    safety_backup_dir: Path,
) -> Path | None:
    verify_checksum(backup, checksum)
    assert_integrity(backup)
    safety_backup = None
    if database.is_file():
        safety_backup, _ = backup_database(database, safety_backup_dir)
    database.parent.mkdir(parents=True, exist_ok=True)
    temporary = database.with_suffix(database.suffix + ".restore.tmp")
    temporary.unlink(missing_ok=True)
    source = sqlite3.connect(f"file:{backup}?mode=ro", uri=True)
    target = sqlite3.connect(temporary)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    assert_integrity(temporary)
    os.replace(temporary, database)
    return safety_backup


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="SQLite backup and restore operations")
    commands = root.add_subparsers(dest="command", required=True)
    backup = commands.add_parser("backup")
    backup.add_argument("--database", type=Path, required=True)
    backup.add_argument("--output-dir", type=Path, required=True)
    restore = commands.add_parser("restore")
    restore.add_argument("--database", type=Path, required=True)
    restore.add_argument("--backup", type=Path, required=True)
    restore.add_argument("--checksum", type=Path, required=True)
    restore.add_argument("--safety-backup-dir", type=Path, required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("--backup", type=Path, required=True)
    verify.add_argument("--checksum", type=Path, required=True)
    return root


def main(argv: list[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    try:
        if arguments.command == "backup":
            database, checksum = backup_database(
                arguments.database.resolve(),
                arguments.output_dir.resolve(),
            )
            print(database)
            print(checksum)
        elif arguments.command == "restore":
            safety = restore_database(
                arguments.database.resolve(),
                arguments.backup.resolve(),
                arguments.checksum.resolve(),
                arguments.safety_backup_dir.resolve(),
            )
            print(f"restored={arguments.database.resolve()}")
            if safety:
                print(f"safety_backup={safety}")
        else:
            verify_checksum(
                arguments.backup.resolve(),
                arguments.checksum.resolve(),
            )
            assert_integrity(arguments.backup.resolve())
            print("backup verification passed")
        return 0
    except (FileNotFoundError, OSError, RuntimeError, sqlite3.Error) as exc:
        print(f"database operation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
