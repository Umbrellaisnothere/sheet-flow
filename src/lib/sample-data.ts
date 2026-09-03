import type { CellValue, SheetRow } from "@/lib/sheet-engine"

export const COLUMN_HEADERS = [
  "SKU",
  "Product",
  "Status",
  "Pick location",
  "Pack location",
  "Qty",
  "Notes",
] as const

export const COLUMN_WIDTHS = [92, 148, 96, 128, 128, 64, 200]

const RAW_ROWS: CellValue[][] = [
  ["WH-104", "Cedar hanger", "Ready", "A-12", "", 24, ""],
  ["WH-118", "Oak shelf", "Hold", "B-03", "B-03", 8, "Already staged"],
  ["WH-221", "Brass hook", "Ready", "A-14", "", 40, ""],
  ["WH-309", "Linen bin", "Shipped", "", "C-01", 12, "Left yesterday"],
  ["WH-415", "Pine crate", "Ready", "A-12", "C-04", 6, "Pack bin already assigned"],
  ["WH-502", "Steel bracket", "Ready", "D-01", "", 100, ""],
  ["WH-618", "Wool pad", "Hold", "E-07", "", 15, "Waiting on QC"],
  ["WH-720", "Canvas tote", "Ready", "A-18", "", 48, ""],
  ["WH-811", "Maple knob", "Shipped", "F-02", "C-09", 30, ""],
  ["WH-903", "Rope coil", "Ready", "B-11", "", 12, ""],
  ["WH-944", "Glass vial", "Ready", "D-08", "D-08", 20, "Do not overwrite"],
  ["WH-955", "Cork stopper", "Hold", "B-11", "", 200, ""],
  ["WH-970", "Soap stone", "Ready", "", "", 4, "Empty pick — skipped"],
  ["WH-982", "Copper nail", "Ready", "G-04", "", 500, ""],
  ["WH-991", "Beeswax bar", "Shipped", "A-01", "C-02", 18, ""],
  ["WH-998", "Linen tape", "Ready", "C-22", "", 36, ""],
]

export function createSampleRows(): SheetRow[] {
  return RAW_ROWS.map((values, index) => ({
    rowNumber: index + 2,
    values: [...values],
    hiddenByFilter: false,
  }))
}

export const SHEET_NAME = "Pack List"
export const LAST_DATA_ROW = RAW_ROWS.length + 1
