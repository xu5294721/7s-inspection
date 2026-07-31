import { describe, expect, test } from "vitest";
import { parseBodyFontSizeInput, parseFirstLineIndentInput } from "./reportTemplateInputs";

describe("parseBodyFontSizeInput", () => {
  test.each([
    [" 三号 ", 16],
    ["12", 12],
    ["12.5", 12.5],
  ])("accepts %j as %d", (value, expected) => {
    expect(parseBodyFontSizeInput(value)).toBe(expected);
  });

  test.each(["", "四号", "0", "-1", "正文"])("rejects %j", (value) => {
    expect(parseBodyFontSizeInput(value)).toBeNull();
  });
});

describe("parseFirstLineIndentInput", () => {
  test.each([
    ["0", 0],
    ["2", 2],
    ["2.5", 2.5],
  ])("accepts %j as %d", (value, expected) => {
    expect(parseFirstLineIndentInput(value)).toBe(expected);
  });

  test.each(["", "-1", "两字符"])("rejects %j", (value) => {
    expect(parseFirstLineIndentInput(value)).toBeNull();
  });
});
