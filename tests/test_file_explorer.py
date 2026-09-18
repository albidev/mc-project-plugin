"""Read-only tree walk and bounded file read tests (issue #27)."""
from __future__ import annotations

from pathlib import Path

import pytest

import file_explorer


def make_repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "src").mkdir(parents=True)
    (root / "src" / "a.ts").write_text("export const a = 1\n", encoding="utf-8")
    (root / "src" / "b.ts").write_text("export const b = 2\n", encoding="utf-8")
    (root / "README.md").write_text("# repo\n", encoding="utf-8")
    (root / ".git").mkdir()
    (root / ".git" / "config").write_text("x", encoding="utf-8")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "dep.js").write_text("x", encoding="utf-8")
    return root


# ---------------------------------------------------------------------------
# valid_relative_path
# ---------------------------------------------------------------------------

def test_valid_relative_path_accepts_root_and_simple_paths() -> None:
    assert file_explorer.valid_relative_path("") is True
    assert file_explorer.valid_relative_path(".") is True
    assert file_explorer.valid_relative_path("src") is True
    assert file_explorer.valid_relative_path("src/a.ts") is True
    assert file_explorer.valid_relative_path("src/./a.ts") is True


def test_valid_relative_path_rejects_traversal_absolute_and_odd_separators() -> None:
    assert file_explorer.valid_relative_path("..") is False
    assert file_explorer.valid_relative_path("src/../x") is False
    assert file_explorer.valid_relative_path("/etc/passwd") is False
    assert file_explorer.valid_relative_path("src\\a.ts") is False
    assert file_explorer.valid_relative_path("a\x00b") is False
    assert file_explorer.valid_relative_path("a\nb") is False


def test_valid_relative_path_enforces_length_and_depth_bounds() -> None:
    assert file_explorer.valid_relative_path("a" * 4097) is False
    deep = "/".join("d" for _ in range(33))
    assert file_explorer.valid_relative_path(deep) is False
    shallow = "/".join("d" for _ in range(32))
    assert file_explorer.valid_relative_path(shallow) is True


# ---------------------------------------------------------------------------
# list_tree
# ---------------------------------------------------------------------------

def test_list_tree_root_orders_dirs_first_then_files_alphabetically(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    entries, truncated = file_explorer.list_tree(root, ".")
    assert truncated is False
    names = [entry["name"] for entry in entries]
    types = [entry["type"] for entry in entries]
    assert names == ["src", "README.md"]
    assert types == ["dir", "file"]
    assert ".git" not in names and "node_modules" not in names
    assert "src" in names and "README.md" in names
    assert all(entry["type"] in ("dir", "file") for entry in entries)
    assert all(not entry["path"].startswith("/") and entry["path"] != ".." for entry in entries)


def test_list_tree_nested_dir_returns_relative_entries(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    entries, truncated = file_explorer.list_tree(root, "src")
    assert truncated is False
    assert [entry["name"] for entry in entries] == ["a.ts", "b.ts"]
    assert [entry["path"] for entry in entries] == ["src/a.ts", "src/b.ts"]
    assert all(entry["type"] == "file" for entry in entries)


def test_list_tree_excludes_git_and_node_modules_at_every_level(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    (root / "src" / "node_modules").mkdir()
    (root / "src" / "node_modules" / "x.js").write_text("x", encoding="utf-8")
    entries, _ = file_explorer.list_tree(root, "src")
    assert "node_modules" not in [entry["name"] for entry in entries]
    for excluded in (".git", "node_modules", ".git/config", "node_modules/dep.js"):
        with pytest.raises(ValueError, match="NOT_ALLOWED"):
            file_explorer.list_tree(root, excluded)


def test_list_tree_rejects_traversal_and_escape(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    with pytest.raises(ValueError, match="NOT_ALLOWED"):
        file_explorer.list_tree(root, "..")
    with pytest.raises(ValueError, match="NOT_ALLOWED"):
        file_explorer.list_tree(root, "src/../x")


def test_list_tree_excludes_symlinks_pointing_outside_root(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    (root / "leak.txt").symlink_to(outside)
    (root / "src" / "dir-out").symlink_to(tmp_path / "sub-out", target_is_directory=True)
    (tmp_path / "sub-out").mkdir()
    (tmp_path / "sub-out" / "x.txt").write_text("x", encoding="utf-8")
    entries, _ = file_explorer.list_tree(root, ".")
    names = [entry["name"] for entry in entries]
    assert "leak.txt" not in names
    assert "dir-out" not in names


def test_list_tree_includes_symlink_pointing_inside_root(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    (root / "src" / "c.ts").symlink_to(root / "README.md")
    entries, _ = file_explorer.list_tree(root, "src")
    names = [entry["name"] for entry in entries]
    assert "c.ts" in names
    entry = next(item for item in entries if item["name"] == "c.ts")
    assert entry["type"] == "file"


def test_list_tree_truncates_at_entry_bound(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    big = root / "big"
    big.mkdir()
    for index in range(file_explorer.MAX_ENTRIES + 500):
        (big / f"f-{index:04d}.txt").write_text("x", encoding="utf-8")
    entries, truncated = file_explorer.list_tree(root, "big")
    assert truncated is True
    assert len(entries) == file_explorer.MAX_ENTRIES


# ---------------------------------------------------------------------------
# read_file
# ---------------------------------------------------------------------------

def test_read_file_text_content(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    result = file_explorer.read_file(root, "src/a.ts")
    assert result["path"] == "src/a.ts"
    assert result["size"] == len(b"export const a = 1\n")
    assert result["binary"] is False
    assert result["truncated"] is False
    assert result["content"] == "export const a = 1\n"


def test_read_file_empty(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    (root / "empty.txt").write_text("", encoding="utf-8")
    result = file_explorer.read_file(root, "empty.txt")
    assert result["size"] == 0
    assert result["binary"] is False
    assert result["truncated"] is False
    assert result["content"] == ""


def test_read_file_binary_detected_without_content(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    payload = b"\x00\x01\x02" + b"x" * 100
    (root / "bin.dat").write_bytes(payload)
    result = file_explorer.read_file(root, "bin.dat")
    assert result["binary"] is True
    assert result.get("content") is None
    assert result["size"] == len(payload)
    assert result["truncated"] is False


def test_read_file_truncated_at_byte_cap(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    payload = b"a" * (file_explorer.MAX_FILE_BYTES + 1024)
    (root / "big.txt").write_bytes(payload)
    result = file_explorer.read_file(root, "big.txt")
    assert result["truncated"] is True
    assert result["size"] == len(payload)
    assert result["content"] is not None
    assert len(result["content"].encode("utf-8")) == file_explorer.MAX_FILE_BYTES
    assert result["content"] == "a" * file_explorer.MAX_FILE_BYTES


def test_read_file_exactly_at_cap_not_truncated(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    payload = b"b" * file_explorer.MAX_FILE_BYTES
    (root / "cap.txt").write_bytes(payload)
    result = file_explorer.read_file(root, "cap.txt")
    assert result["truncated"] is False
    assert result["content"] == "b" * file_explorer.MAX_FILE_BYTES


def test_read_file_utf8_content_is_byte_bounded(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    # 90k multi-byte chars: > 256KB bytes would overrun a char-count cap.
    payload = ("é" * 150_000).encode("utf-8")
    assert len(payload) > file_explorer.MAX_FILE_BYTES
    (root / "utf.txt").write_bytes(payload)
    result = file_explorer.read_file(root, "utf.txt")
    assert result["truncated"] is True
    assert len(result["content"].encode("utf-8")) == file_explorer.MAX_FILE_BYTES


def test_read_file_containment_and_exclusions(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    for blocked in (".git", "node_modules", ".git/config", "..", "src/../x", "/etc/passwd"):
        with pytest.raises(ValueError, match="NOT_ALLOWED"):
            file_explorer.read_file(root, blocked)


def test_read_file_symlink_escape_rejected(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    (root / "leak.txt").symlink_to(outside)
    with pytest.raises(ValueError, match="NOT_ALLOWED"):
        file_explorer.read_file(root, "leak.txt")


def test_read_file_symlink_inside_allowed(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    (root / "link.txt").symlink_to(root / "README.md")
    result = file_explorer.read_file(root, "link.txt")
    assert result["content"] == "# repo\n"


def test_read_file_missing_raises_file_not_found(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    with pytest.raises(FileNotFoundError):
        file_explorer.read_file(root, "missing.txt")


def test_read_file_directory_is_rejected(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    with pytest.raises(ValueError, match="NOT_ALLOWED"):
        file_explorer.read_file(root, "src")


# ---------------------------------------------------------------------------
# read_file_raw (#34)
# ---------------------------------------------------------------------------

def _tiny_png() -> bytes:
    # Minimal 1x1 PNG: valid header, IHDR, IDAT, IEND.
    # This is a hand-built PNG fixture that browsers/decoders accept as PNG.
    import base64 as _b64
    return _b64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
        "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    )


def test_read_file_raw_png_content_type_and_hash(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    payload = _tiny_png()
    (root / "img.png").write_bytes(payload)
    result = file_explorer.read_file_raw(root, "img.png")
    assert result["path"] == "img.png"
    assert result["contentType"] == "image/png"
    assert result["size"] == len(payload)
    assert result["truncated"] is False
    import base64 as _b64
    encoded = result["contentBase64"]
    assert isinstance(encoded, str)
    assert _b64.b64decode(encoded) == payload


def test_read_file_raw_pdf_content_type(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    payload = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
    (root / "doc.pdf").write_bytes(payload)
    result = file_explorer.read_file_raw(root, "doc.pdf")
    assert result["contentType"] == "application/pdf"
    assert result["truncated"] is False


def test_read_file_raw_unknown_extension_is_octet_stream(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    payload = b"\x00\x01\x02arbitrary"
    (root / "blob.xyz").write_bytes(payload)
    result = file_explorer.read_file_raw(root, "blob.xyz")
    assert result["contentType"] == "application/octet-stream"
    import base64 as _b64
    encoded = result["contentBase64"]
    assert isinstance(encoded, str)
    assert _b64.b64decode(encoded) == payload


def test_read_file_raw_empty_file(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    (root / "empty.bin").write_bytes(b"")
    result = file_explorer.read_file_raw(root, "empty.bin")
    assert result["size"] == 0
    assert result["contentBase64"] == ""
    assert result["truncated"] is False


def test_read_file_raw_over_cap_raises_payload_too_large(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    payload = b"x" * (file_explorer.MAX_FILE_BYTES + 1)
    (root / "big.bin").write_bytes(payload)
    with pytest.raises(ValueError, match="PAYLOAD_TOO_LARGE"):
        file_explorer.read_file_raw(root, "big.bin")


def test_read_file_raw_exactly_at_cap_ok(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    payload = b"b" * file_explorer.MAX_FILE_BYTES
    (root / "cap.bin").write_bytes(payload)
    result = file_explorer.read_file_raw(root, "cap.bin")
    assert result["size"] == file_explorer.MAX_FILE_BYTES
    assert result["truncated"] is False


def test_read_file_raw_containment_and_exclusions(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    for blocked in (".git", "node_modules", ".git/config", "..", "src/../x", "/etc/passwd", "src"):
        with pytest.raises(ValueError, match="NOT_ALLOWED"):
            file_explorer.read_file_raw(root, blocked)


def test_read_file_raw_symlink_escape_rejected_and_inside_allowed(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    outside = tmp_path / "outside.bin"
    outside.write_bytes(b"secret-bytes")
    (root / "leak.bin").symlink_to(outside)
    with pytest.raises(ValueError, match="NOT_ALLOWED"):
        file_explorer.read_file_raw(root, "leak.bin")
    (root / "link.png").symlink_to(root / "README.md")
    result = file_explorer.read_file_raw(root, "link.png")
    # Content-Type follows the filename extension, not the content (contract).
    assert result["contentType"] == "image/png"


def test_read_file_raw_missing_raises_file_not_found(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    with pytest.raises(FileNotFoundError):
        file_explorer.read_file_raw(root, "missing.bin")
