"""Read-only workspace tree walk and bounded file reads with root containment.

Issue #27: the Code workspace mode (#26) needs to explore and read project
files without ever escaping the approved project root.  All functions here
are pure filesystem operations; endpoints.py owns the HTTP boundary and
translates ValueError("NOT_ALLOWED") into ServiceError 403.
"""
from __future__ import annotations

import base64
import os
from pathlib import Path

MAX_ENTRIES = 2_000
MAX_FILE_BYTES = 262_144
BINARY_SCAN_BYTES = 8_192
MAX_PATH_LEN = 4_096
MAX_PATH_DEPTH = 32
EXCLUDED_DIR_NAMES = (".git", "node_modules")


class NotAllowedError(ValueError):
    """Path is outside the approved root or inside an excluded directory."""


class PayloadTooLargeError(ValueError):
    """File size exceeds MAX_FILE_BYTES; a truncated preview is corrupt."""


_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
}


def content_type_for(rel: str) -> str:
    suffix = Path(rel).suffix.lower()
    return _CONTENT_TYPES.get(suffix, "application/octet-stream")


def valid_relative_path(value: str) -> bool:
    """Relative path policy shared by listTree and readFile (#27 D4).

    Rejects absolute paths, ``..`` segments, backslashes (separator
    ambiguity), NUL/control characters, and paths beyond length/depth bounds.
    """
    if len(value) > MAX_PATH_LEN:
        return False
    if value.startswith("/") or "\\" in value or "\x00" in value:
        return False
    parts = value.split("/")
    if len(parts) > MAX_PATH_DEPTH:
        return False
    if any(ord(char) < 32 for char in value):
        return False
    if any(part in ("", "..") for part in parts):
        # '' only allowed at the root form; '..' never allowed.
        return value in ("", ".")
    return True


def _is_excluded(parts: list[str]) -> bool:
    return any(part in EXCLUDED_DIR_NAMES for part in parts)


def _resolve_inside(root: Path, rel: str, *, must_exist: bool) -> Path:
    """Resolve rel inside root, raising NotAllowedError on escape.

    Symlinks are resolved with strict=False so a dangling link still reports
    its target position; escape detection happens on the resolved target.
    """
    candidate = (root / rel).resolve(strict=False)
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise NotAllowedError("NOT_ALLOWED") from exc
    if must_exist and not candidate.exists():
        raise FileNotFoundError(rel)
    return candidate


def list_tree(root: Path, rel: str) -> tuple[list[dict[str, object]], bool]:
    """List one directory level, dirs first then files, alphabetical.

    Returns (entries, truncated).  Never follows directory symlinks and never
    lists .git / node_modules at any level (#27 contract).
    """
    if not valid_relative_path(rel):
        raise NotAllowedError("NOT_ALLOWED")
    parts = rel.split("/") if rel not in ("", ".") else []
    if _is_excluded([] if rel in ("", ".") else parts):
        raise NotAllowedError("NOT_ALLOWED")
    directory = _resolve_inside(root, rel, must_exist=True)
    if not directory.is_dir():
        raise NotAllowedError("NOT_ALLOWED")

    entries: list[dict[str, object]] = []
    truncated = False
    with os.scandir(directory) as scanner:
        scanned = sorted(scanner, key=lambda item: item.name)
        for item in scanned:
            if len(entries) >= MAX_ENTRIES:
                truncated = True
                break
            if item.name in EXCLUDED_DIR_NAMES:
                continue
            path = item.name if rel in ("", ".") else f"{rel}/{item.name}"
            if item.is_dir(follow_symlinks=False):
                # Directory symlinks are never followed and never listed.
                if item.is_symlink():
                    continue
                entries.append({"name": item.name, "path": path, "type": "dir"})
                continue
            resolved = (directory / item.name).resolve(strict=False)
            try:
                resolved.relative_to(root)
            except ValueError:
                # Symlink (or file) escaping the root: excluded, not listed.
                continue
            if item.is_file():
                entries.append({"name": item.name, "path": path, "type": "file"})
    entries.sort(key=lambda entry: (0 if entry["type"] == "dir" else 1, entry["name"]))
    return entries, truncated


def read_file(root: Path, rel: str) -> dict[str, object]:
    """Read one file bounded to MAX_FILE_BYTES, never reading past the cap.

    stat first; scan only the first BINARY_SCAN_BYTES for a NUL byte to detect
    binary; returns {path, size, content?, truncated, binary}.
    """
    if not valid_relative_path(rel):
        raise NotAllowedError("NOT_ALLOWED")
    parts = rel.split("/")
    if _is_excluded(parts):
        raise NotAllowedError("NOT_ALLOWED")
    target = _resolve_inside(root, rel, must_exist=True)
    if not target.is_file():
        if target.is_dir():
            raise NotAllowedError("NOT_ALLOWED")
        raise NotAllowedError("NOT_ALLOWED")
    stat = target.stat()
    binary = False
    truncated = stat.st_size > MAX_FILE_BYTES
    read_size = min(stat.st_size, MAX_FILE_BYTES)
    with target.open("rb") as handle:
        head = handle.read(BINARY_SCAN_BYTES)
        binary = b"\x00" in head
        if binary:
            return {
                "path": rel,
                "size": stat.st_size,
                "truncated": truncated,
                "binary": True,
            }
        handle.seek(0)
        content = handle.read(read_size)
    return {
        "path": rel,
        "size": stat.st_size,
        "content": content.decode("utf-8", errors="replace"),
        "truncated": truncated,
        "binary": False,
    }


def read_file_raw(root: Path, rel: str) -> dict[str, object]:
    """Read a whole file (<= cap) as base64 with extension Content-Type.

    For the binary preview contract (#34): the entire file is returned as
    base64, never truncated (a truncated preview is corrupt). Files above
    MAX_FILE_BYTES raise PayloadTooLargeError without being read.

    Raises NotAllowedError for excluded/escaping paths and directories,
    FileNotFoundError for missing files, PayloadTooLargeError when the file
    exceeds MAX_FILE_BYTES.
    """
    if not valid_relative_path(rel):
        raise NotAllowedError("NOT_ALLOWED")
    parts = rel.split("/")
    if _is_excluded(parts):
        raise NotAllowedError("NOT_ALLOWED")
    target = _resolve_inside(root, rel, must_exist=True)
    if not target.is_file():
        raise NotAllowedError("NOT_ALLOWED")
    stat = target.stat()
    if stat.st_size > MAX_FILE_BYTES:
        raise PayloadTooLargeError("PAYLOAD_TOO_LARGE")
    with target.open("rb") as handle:
        content = handle.read(stat.st_size)
    return {
        "path": rel,
        "contentType": content_type_for(rel),
        "size": stat.st_size,
        "contentBase64": base64.b64encode(content).decode("ascii"),
        "truncated": False,
    }
