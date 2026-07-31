import importlib.util
import json
import pathlib
import tempfile
import unittest


SCRIPT_PATH = pathlib.Path(__file__).with_name("extract-default-items.py")
SPEC = importlib.util.spec_from_file_location("extract_default_items", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

SOURCE_PATH = pathlib.Path(__file__).parents[2] / "向塘钢轨焊接整修7S管理考核办法.docx"


class ExtractionContractTests(unittest.TestCase):
    def test_numbered_standards_preserve_order_and_repeated_original_numbers(self):
        segments = MODULE.split_numbered_standards("1、第一条 11.第十一条 11．重复十一条")
        self.assertEqual(segments, [("1", "第一条"), ("11", "第十一条"), ("11", "重复十一条")])

    def test_numbered_standards_fail_clearly_when_no_numbered_segment_exists(self):
        with self.assertRaisesRegex(ValueError, "无法拆分编号标准"):
            MODULE.split_numbered_standards("没有编号的标准")

    def test_python_sha256_matches_shared_browser_fixture(self):
        fixture_path = pathlib.Path(__file__).parents[1] / "src/features/items/item-id-vectors.json"
        for vector in json.loads(fixture_path.read_text(encoding="utf-8")):
            actual = MODULE.stable_id(
                vector["routeName"], vector["area"], vector["device"], vector["part"]
            )
            self.assertEqual(actual, vector["id"])

    def test_validation_fails_for_missing_fields_and_duplicate_ids(self):
        valid = {
            "id": "same",
            "routeName": "路线",
            "area": "区域",
            "part": "部位",
            "standard": "标准",
            "team": "班组",
        }
        with self.assertRaisesRegex(ValueError, "缺少必填字段"):
            MODULE.validate_items([{**valid, "team": ""}])
        with self.assertRaisesRegex(ValueError, "重复 ID"):
            MODULE.validate_items([valid, dict(valid)])

    def test_source_extracts_449_unique_enabled_items_on_24_routes_deterministically(self):
        first = MODULE.extract_items(SOURCE_PATH)
        second = MODULE.extract_items(SOURCE_PATH)

        self.assertEqual(len(first), 449)
        self.assertEqual(len({item["routeName"] for item in first}), 24)
        self.assertEqual(len({item["id"] for item in first}), 449)
        self.assertTrue(all(item["enabled"] for item in first))
        self.assertTrue(
            all(
                item[field]
                for item in first
                for field in (
                    "routeName",
                    "area",
                    "part",
                    "standard",
                    "team",
                    "goodText",
                    "reminderText",
                    "assessmentText",
                )
            )
        )
        self.assertEqual(MODULE.serialize_items(first), MODULE.serialize_items(second))

    def test_writes_identical_utf8_json_bytes_on_two_runs(self):
        items = MODULE.extract_items(SOURCE_PATH)
        with tempfile.TemporaryDirectory() as directory:
            first = pathlib.Path(directory) / "first.json"
            second = pathlib.Path(directory) / "second.json"
            MODULE.write_items(items, first)
            MODULE.write_items(items, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())


if __name__ == "__main__":
    unittest.main()
