import { promises as fs } from "node:fs";
import path from "node:path";

import { auditEntityVitals } from "../output/runtime/packages/data-core/src/entity-vitals-audit.js";
import { loadLibraryFromDisk } from "../output/runtime/packages/data-core/src/library-store.js";

// F21: this audit is a gate. Any issue makes the command exit non-zero so
// `npm run check` and CI fail instead of only printing a JSON report.
async function main() {
  const library = await loadLibraryFromDisk();
  const result = auditEntityVitals(library);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(process.cwd(), "output", "entity-vitals-audit");
  await fs.mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `entity-vitals-audit-${timestamp}.json`);
  await fs.writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ...result,
        gate: {
          failed: result.issues.length > 0,
          issueCount: result.issues.length,
        },
        artifacts: {
          jsonPath,
        },
      },
      null,
      2,
    ),
  );
  if (result.issues.length > 0) {
    console.error(`[entity-vitals] ${result.issues.length} issue(s) found; failing the audit gate.`);
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.stack || error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
