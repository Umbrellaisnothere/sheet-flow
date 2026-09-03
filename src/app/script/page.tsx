import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ScriptCopyPage } from "@/components/script-copy-page";

export default function ScriptPage() {
  const scriptSource = readFileSync(
    join(process.cwd(), "apps-script", "Code.gs"),
    "utf8"
  );

  return <ScriptCopyPage scriptSource={scriptSource} />;
}
