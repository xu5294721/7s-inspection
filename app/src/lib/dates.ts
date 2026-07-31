export function toInspectionTimestamp(inspectionDate: string): string {
  return `${inspectionDate}T00:00:00.000Z`;
}

export function toLocalInspectionDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
