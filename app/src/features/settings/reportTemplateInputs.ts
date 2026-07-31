function parseNonnegativeDecimal(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseBodyFontSizeInput(value: string): number | null {
  if (value.trim() === "三号") return 16;

  const parsed = parseNonnegativeDecimal(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function parseFirstLineIndentInput(value: string): number | null {
  return parseNonnegativeDecimal(value);
}
