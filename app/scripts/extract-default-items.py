#!/usr/bin/env python3
"""Extract reproducible default checklist items from the embedded 7S workbook."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import zipfile
from collections.abc import Iterable
from typing import Any

import xlrd


SOURCE_MEMBER = "word/embeddings/oleObject1.bin"
SHEET_NAME = "包保划分表"
DATA_ROW_START = 2  # Excel row 3, zero-based for xlrd.
SOURCE_TIMESTAMP = "2024-05-15T00:00:00.000Z"
REQUIRED_FIELDS = ("id", "routeName", "area", "part", "standard", "team")
NUMBERED_STANDARD = re.compile(r"(?<!\S)(\d+)[、．.]")
WHITESPACE = re.compile(r"[\s\u3000]+")


def normalize(value: str) -> str:
    return WHITESPACE.sub(" ", value.strip())


def stable_id(route_name: str, area: str, device: str, part: str) -> str:
    canonical_key = "\x1f".join(normalize(value) for value in (route_name, area, device, part))
    return hashlib.sha256(canonical_key.encode("utf-8")).hexdigest()[:16]


def split_numbered_standards(value: str) -> list[tuple[str, str]]:
    matches = list(NUMBERED_STANDARD.finditer(value))
    if not matches:
        raise ValueError("无法拆分编号标准：未找到编号标记")

    segments: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        next_start = matches[index + 1].start() if index + 1 < len(matches) else len(value)
        standard = value[match.end() : next_start].strip()
        if not standard:
            raise ValueError(f"无法拆分编号标准：编号 {match.group(1)} 后为空")
        segments.append((match.group(1), standard))
    return segments


def merged_cell_value(sheet: xlrd.sheet.Sheet, row_index: int, column_index: int) -> Any:
    for row_low, row_high, column_low, column_high in sheet.merged_cells:
        if row_low <= row_index < row_high and column_low <= column_index < column_high:
            return sheet.cell_value(row_low, column_low)
    return sheet.cell_value(row_index, column_index)


def text_cell(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("必须为文本")
    return value.strip()


def positive_integer(value: Any) -> int:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        integer = int(value)
        if value == integer and integer > 0:
            return integer
    if isinstance(value, str) and value.strip().isdigit() and int(value.strip()) > 0:
        return int(value.strip())
    raise ValueError("必须为正整数")


def validate_items(items: Iterable[dict[str, Any]]) -> None:
    seen_ids: set[str] = set()
    for index, item in enumerate(items, start=1):
        missing = [field for field in REQUIRED_FIELDS if not isinstance(item.get(field), str) or not item[field].strip()]
        if missing:
            raise ValueError(f"缺少必填字段：第 {index} 项 {', '.join(missing)}")
        item_id = item["id"]
        if item_id in seen_ids:
            raise ValueError(f"重复 ID：{item_id}")
        seen_ids.add(item_id)


def extract_items(source_path: pathlib.Path) -> list[dict[str, Any]]:
    try:
        with zipfile.ZipFile(source_path) as archive:
            workbook_bytes = archive.read(SOURCE_MEMBER)
    except KeyError as error:
        raise ValueError(f"未找到嵌入工作簿：{SOURCE_MEMBER}") from error

    workbook = xlrd.open_workbook(file_contents=workbook_bytes, formatting_info=True)
    try:
        sheet = workbook.sheet_by_name(SHEET_NAME)
    except xlrd.biffh.XLRDError as error:
        raise ValueError(f"未找到工作表：{SHEET_NAME}") from error

    expected_headers = ["序号", "包保区域", "具体划分", "包保班组", "包保人员", "具体标准"]
    actual_headers = [text_cell(sheet.cell_value(1, column)) for column in range(len(expected_headers))]
    if actual_headers != expected_headers:
        raise ValueError(f"工作表表头不符合预期：{actual_headers}")

    items: list[dict[str, Any]] = []
    route_orders: dict[str, int] = {}
    for row_index in range(DATA_ROW_START, sheet.nrows):
        source_row = row_index + 1
        try:
            source_order = positive_integer(sheet.cell_value(row_index, 0))
            route_name = text_cell(merged_cell_value(sheet, row_index, 1))
            area = text_cell(sheet.cell_value(row_index, 2))
            team = text_cell(sheet.cell_value(row_index, 3))
            standards = text_cell(merged_cell_value(sheet, row_index, 5))
        except ValueError as error:
            raise ValueError(f"源 Excel 第 {source_row} 行缺少必填字段：{error}") from error

        route_order = route_orders.setdefault(route_name, source_order)
        try:
            segments = split_numbered_standards(standards)
        except ValueError as error:
            raise ValueError(f"源 Excel 第 {source_row} 行{error}") from error

        for segment_index, (original_number, standard) in enumerate(segments, start=1):
            part = f"检查标准第{segment_index}项（原编号{original_number}）"
            item = {
                "id": stable_id(route_name, area, "", part),
                "routeOrder": route_order,
                "routeName": route_name,
                "area": area,
                "device": "",
                "part": part,
                "standard": standard,
                "team": team,
                "sevenSCategory": "",
                "goodText": f"{part}落实较好。",
                "reminderText": f"{part}落实不到位，本次予以提醒。",
                "assessmentText": f"{part}落实不到位。",
                "quickPhrases": [],
                "enabled": True,
                "createdAt": SOURCE_TIMESTAMP,
                "updatedAt": SOURCE_TIMESTAMP,
            }
            items.append(item)

    validate_items(items)
    return items


def serialize_items(items: list[dict[str, Any]]) -> bytes:
    return (json.dumps(items, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def write_items(items: list[dict[str, Any]], output_path: pathlib.Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(serialize_items(items))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    arguments = parser.parse_args()

    items = extract_items(arguments.source)
    write_items(items, arguments.output)
    print(f"Extracted {len(items)} items across {len({item['routeName'] for item in items})} routes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
