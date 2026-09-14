"""Shared Git ref/branch grammar."""
from __future__ import annotations

import re

_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")


def is_valid_ref_name(value: object) -> bool:
    if not isinstance(value, str) or not _REF.fullmatch(value):
        return False
    if ".." in value or "//" in value or "@{" in value or value.endswith((".", ".lock", "/")):
        return False
    return all(
        part not in {"", ".", ".."}
        and not part.startswith(".")
        and not part.endswith((".", ".lock"))
        for part in value.split("/")
    )
