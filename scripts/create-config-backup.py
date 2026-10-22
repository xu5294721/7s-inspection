#!/usr/bin/env python3
"""Create a settings-only 7S backup from a verified app backup archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path


DATA_PATHS = {
    "checklistItems": "data/checklist-items.json",
    "templates": "data/templates.json",
    "routeTemplates": "data/route-templates.json",
    "inspections": "data/inspections.json",
    "entries": "data/entries.json",
    "photoGroups": "data/photo-groups.json",
    "photos": "data/photos.json",
    "settings": "data/settings.json",
}
EMPTY_TABLES = {"inspections", "entries", "photoGroups", "photos"}
RESTORABLE_SETTING_KEYS = {"inspection-check-template"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_verified_archive(path: Path) -> tuple[dict, dict[str, bytes]]:
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("schemaVersion") != 3:
            raise ValueError("仅支持 schemaVersion 3 的源备份。")
        payloads = {}
        for name, record in manifest["files"].items():
            data = archive.read(name)
            if sha256(data) != record["sha256"]:
                raise ValueError(f"源备份校验失败：{name}")
            payloads[name] = data
        if set(payloads) != set(archive.namelist()) - {"manifest.json"}:
            raise ValueError("源 ZIP 条目与 manifest 不一致。")
        return manifest, payloads


def build_config_backup(source: Path, destination: Path) -> dict:
    _, source_payloads = read_verified_archive(source)
    data = {}
    for table, name in DATA_PATHS.items():
        if name not in source_payloads:
            raise ValueError(f"源备份缺少必需数据：{name}")
        rows = json.loads(source_payloads[name])
        if table in EMPTY_TABLES:
            data[table] = []
        elif table == "settings":
            data[table] = [row for row in rows if row.get("key") in RESTORABLE_SETTING_KEYS]
        else:
            data[table] = rows

    payloads = {
        DATA_PATHS[table]: json.dumps(rows, ensure_ascii=False, indent=2).encode("utf-8")
        for table, rows in data.items()
    }
    created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    manifest = {
        "schemaVersion": 3,
        "createdAt": created_at,
        "rowCounts": {table: len(rows) for table, rows in data.items()},
        "files": {name: {"sha256": sha256(payload)} for name, payload in payloads.items()},
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, payload in payloads.items():
            archive.writestr(name, payload)
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    manifest = build_config_backup(args.source, args.destination)
    with zipfile.ZipFile(args.destination) as archive:
        names = set(archive.namelist())
        if any(name.startswith("photos/") for name in names):
            raise ValueError("配置备份不应包含照片文件。")
        if names != set(manifest["files"]) | {"manifest.json"}:
            raise ValueError("生成的 ZIP 路径与 manifest 不一致。")
    print(json.dumps({"output": str(args.destination), "rowCounts": manifest["rowCounts"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
