import { promises as fs } from "node:fs";

import {
  auditReferenceRegistry,
  buildReferenceRegistry,
  getOrchestraReferenceDefaultPath,
  getPersonReferenceDefaultPath,
} from "../packages/data-core/src/reference-registry.js";

// F21: this audit is a gate. Duplicate/ambiguous reference entries make the
// command exit non-zero so `npm run check` and CI fail instead of only printing.
async function main() {
  const orchestraPath = getOrchestraReferenceDefaultPath();
  const personPath = getPersonReferenceDefaultPath();
  const [orchestraSourceText, personSourceText] = await Promise.all([
    fs.readFile(orchestraPath, "utf8").catch(() => ""),
    fs.readFile(personPath, "utf8").catch(() => ""),
  ]);
  const registry = buildReferenceRegistry({ orchestraSourceText, personSourceText });
  const issues = auditReferenceRegistry(registry);
  console.log(
    JSON.stringify(
      {
        orchestraEntries: registry.orchestraEntries.length,
        personEntries: registry.personEntries.length,
        issueCount: issues.length,
        gate: { failed: issues.length > 0, issueCount: issues.length },
        issues,
      },
      null,
      2,
    ),
  );
  if (issues.length > 0) {
    console.error(`[reference-registry] ${issues.length} issue(s) found; failing the audit gate.`);
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

await main();
