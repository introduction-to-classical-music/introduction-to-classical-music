// F21 audit-gate self-test.
//
// CI and `npm run check` must fail when an audit finds an issue. This script
// builds throw-away fixtures, runs the real audit commands against them and
// asserts both directions:
//   - clean fixture  -> exit code 0
//   - injected issue -> exit code 1
//
// It is intentionally not a vitest test: the audit scripts are command-line
// gates that import the compiled runtime under output/runtime.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const entityVitalsScript = path.join(scriptDir, "audit-entity-vitals.mjs");
const referenceAuditScript = path.join(repoRoot, "output", "runtime", "scripts", "audit-reference-registry.js");
const failures = [];

function check(condition, message) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${message}`);
  if (!condition) {
    failures.push(message);
  }
}

function runAudit(scriptPath, options) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error.message) : "",
  };
}

async function writeJsonWithDirs(rootDir, relativePath, value) {
  const target = path.join(rootDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createLibraryFixture(rootDir, composer) {
  await writeJsonWithDirs(rootDir, "library.manifest.json", {
    schemaVersion: "library-bundle-v1",
    libraryId: "audit-gate-fixture",
    libraryName: "audit gate fixture",
    createdAt: "2026-03-21T00:00:00.000Z",
    updatedAt: "2026-03-21T00:00:00.000Z",
    appMinVersion: "0.1.1",
  });
  await writeJsonWithDirs(rootDir, "content/library/composers.json", [composer]);
  await writeJsonWithDirs(rootDir, "content/library/people.json", []);
  await writeJsonWithDirs(rootDir, "content/library/work-groups.json", []);
  await writeJsonWithDirs(rootDir, "content/library/works.json", []);
  await writeJsonWithDirs(rootDir, "content/library/recordings.json", []);
  await writeJsonWithDirs(rootDir, "content/library/review-queue.json", []);
  await writeJsonWithDirs(rootDir, "content/library/entity-vitals-review.json", []);
  await writeJsonWithDirs(rootDir, "content/library/person-links.json", { canonicalPersonLinks: {} });
  await writeJsonWithDirs(rootDir, "content/site/config.json", { title: "audit gate fixture" });
  await writeJsonWithDirs(rootDir, "content/site/articles.json", []);
}

function entityVitalsEnv(libraryRoot, appDataRoot) {
  return {
    ICM_REPO_ROOT: repoRoot,
    ICM_RUNTIME_MODE: "bundle",
    ICM_ACTIVE_LIBRARY_DIR: libraryRoot,
    ICM_DEFAULT_LIBRARY_DIR: libraryRoot,
    ICM_APP_DATA_DIR: appDataRoot,
  };
}

async function writeReferenceFixture(fixtureDir, orchestraText, personText) {
  const referenceDir = path.join(fixtureDir, "materials", "references");
  await mkdir(referenceDir, { recursive: true });
  await writeFile(path.join(referenceDir, "Orchestra Abbreviation Comparison.txt"), orchestraText, "utf8");
  await writeFile(path.join(referenceDir, "person-name-aliases.txt"), personText, "utf8");
}

function parseIssueCount(stdout) {
  try {
    const parsed = JSON.parse(stdout.slice(stdout.indexOf("{")));
    return Number(parsed.issueCount ?? parsed.gate?.issueCount ?? 0);
  } catch {
    return -1;
  }
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "icm-audit-gate-selftest-"));
try {
  if (!existsSync(referenceAuditScript)) {
    throw new Error(`missing compiled audit script: ${referenceAuditScript} (run npm run runtime:build)`);
  }
  for (const relativeDir of ["run-bad-entity", "run-clean-entity"]) {
    await mkdir(path.join(tempRoot, relativeDir), { recursive: true });
  }

  // --- entity vitals gate ---------------------------------------------------
  const badLibraryRoot = path.join(tempRoot, "library-bad");
  await createLibraryFixture(badLibraryRoot, {
    id: "composer-bad",
    slug: "composer-bad",
    name: "贝多芬",
    nameLatin: "Ludwig van Beethoven",
    country: "Germany",
    sortKey: "0010",
    summary: "德国作曲家。",
  });
  const badEntityResult = runAudit(entityVitalsScript, {
    cwd: path.join(tempRoot, "run-bad-entity"),
    env: entityVitalsEnv(badLibraryRoot, path.join(tempRoot, "appdata-bad-entity")),
  });
  check(
    badEntityResult.status === 1,
    `entity-vitals audit fails on a placeholder issue (exit=${badEntityResult.status})`,
  );
  check(
    badEntityResult.stdout.includes('"issues"'),
    "entity-vitals injected run prints the issue report",
  );

  const cleanLibraryRoot = path.join(tempRoot, "library-clean");
  await createLibraryFixture(cleanLibraryRoot, {
    id: "composer-clean",
    slug: "composer-clean",
    name: "贝多芬",
    nameLatin: "Ludwig van Beethoven",
    country: "Germany",
    birthYear: 1770,
    deathYear: 1827,
    sortKey: "0010",
    summary: "",
  });
  const cleanEntityResult = runAudit(entityVitalsScript, {
    cwd: path.join(tempRoot, "run-clean-entity"),
    env: entityVitalsEnv(cleanLibraryRoot, path.join(tempRoot, "appdata-clean-entity")),
  });
  check(
    cleanEntityResult.status === 0,
    `entity-vitals audit passes a clean fixture (exit=${cleanEntityResult.status})`,
  );

  // --- reference registry gate ---------------------------------------------
  const dirtyReferenceDir = path.join(tempRoot, "references-dirty");
  await mkdir(path.join(tempRoot, "run-dirty-reference"), { recursive: true });
  await writeReferenceFixture(
    dirtyReferenceDir,
    [
      "BPO = 柏林爱乐乐团 = Berliner Philharmoniker",
      "BPO = 布达佩斯爱乐乐团 = Budapest Philharmonic Orchestra",
      "",
    ].join("\n"),
    "#global\n巴伦博伊姆 = Daniel Barenboim\n",
  );
  const dirtyReferenceResult = runAudit(referenceAuditScript, {
    cwd: dirtyReferenceDir,
    env: { ICM_REPO_ROOT: repoRoot },
  });
  check(
    dirtyReferenceResult.status === 1,
    `reference-registry audit fails on an ambiguous abbreviation (exit=${dirtyReferenceResult.status})`,
  );
  check(
    parseIssueCount(dirtyReferenceResult.stdout) > 0,
    `reference-registry injected run reports issueCount>0 (${parseIssueCount(dirtyReferenceResult.stdout)})`,
  );

  const cleanReferenceDir = path.join(tempRoot, "references-clean");
  await writeReferenceFixture(
    cleanReferenceDir,
    "BPO = 柏林爱乐乐团 = Berliner Philharmoniker\n",
    "#global\n巴伦博伊姆 = Daniel Barenboim\n",
  );
  const cleanReferenceResult = runAudit(referenceAuditScript, {
    cwd: cleanReferenceDir,
    env: { ICM_REPO_ROOT: repoRoot },
  });
  check(
    cleanReferenceResult.status === 0,
    `reference-registry audit passes a clean fixture (exit=${cleanReferenceResult.status})`,
  );
  check(
    parseIssueCount(cleanReferenceResult.stdout) === 0,
    `reference-registry clean run reports issueCount=0 (${parseIssueCount(cleanReferenceResult.stdout)})`,
  );
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  failures.push(String(error));
} finally {
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}

console.log(`RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} (${failures.length} failure(s))`);
process.exitCode = failures.length === 0 ? 0 : 1;
