/**
 * CSV export helpers (unit-tested in tests/csv.test.ts).
 * Cells starting with = + - @ (or tab/CR) are prefixed with ' so spreadsheet apps do not execute them as
 * formulas (CSV/formula injection). Negative numbers are left intact.
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

const isNumericString = (s: string) => /^-?\d+(\.\d+)?$/.test(s);

export const csvCell = (value: unknown): string => {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !isNumericString(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

export const toCsv = <T,>(rows: T[], columns: CsvColumn<T>[]): string => {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  }
  return lines.join('\r\n');
};

/** Saves CSV via a download (Electron shows the native Save dialog). BOM so Excel reads UTF-8 (₹). */
export const downloadCsv = (filename: string, csv: string): void => {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
