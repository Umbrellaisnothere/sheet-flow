import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SpreadsheetApp } from "@/components/spreadsheet-app";

export default function Home() {
  const scriptSource = readFileSync(
    join(process.cwd(), "apps-script", "Code.gs"),
    "utf8"
  );

  return <SpreadsheetApp scriptSource={scriptSource} />;
}
