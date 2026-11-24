import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { auditSiteOutputForLocalPaths } from "../../packages/data-core/src/site-output-audit.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

async function createSiteDir() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "classical-site-output-audit-"));
  tempDirs.push(tempRoot);
  await mkdir(path.join(tempRoot, "composers"), { recursive: true });
  await writeFile(
    path.join(tempRoot, "index.html"),
    '<!DOCTYPE html><html><head><link rel="stylesheet" href="/_astro/app.css"></head><body>ok</body></html>\n',
    "utf8",
  );
  await writeFile(
    path.join(tempRoot, "composers", "index.html"),
    '<a href="/composers/beethoven/">Beethoven</a>\n<p>HKO &amp; RO</p>\n',
    "utf8",
  );
  await mkdir(path.join(tempRoot, "_astro"), { recursive: true });
  await writeFile(path.join(tempRoot, "_astro", "app.css"), "body{}\n", "utf8");
  return tempRoot;
}

describe("public site output audit (F15)", () => {
  it("accepts clean output", async () => {
    const root = await createSiteDir();
    const audit = await auditSiteOutputForLocalPaths(root);

    expect(audit.ok).toBe(true);
    expect(audit.checkedFiles).toBeGreaterThan(0);
    expect(audit.localResourceUrls).toEqual([]);
    expect(audit.absolutePathHits).toEqual([]);
  });

  it("detects local-resource endpoints in emitted files", async () => {
    const root = await createSiteDir();
    await writeFile(
      path.join(root, "composers", "index.html"),
      '<a href="/__local-resource?path=D%3A%5CMusic%5Cx.flac">本地文件</a>\n',
      "utf8",
    );

    const audit = await auditSiteOutputForLocalPaths(root);

    expect(audit.ok).toBe(false);
    expect(audit.localResourceUrls).toHaveLength(1);
    expect(audit.localResourceUrls[0]?.path).toBe("composers/index.html");
    expect(audit.localResourceUrls[0]?.line).toBe(1);
  });

  it("detects absolute Windows paths in emitted files, including JSON-escaped ones", async () => {
    const root = await createSiteDir();
    await mkdir(path.join(root, "data"), { recursive: true });
    await writeFile(path.join(root, "data", "library.json"), '{"localPath":"D:\\\\Music\\\\x.flac"}\n', "utf8");
    await writeFile(path.join(root, "about.html"), "<p>C:\\Users\\maintainer\\library</p>\n", "utf8");

    const audit = await auditSiteOutputForLocalPaths(root);

    expect(audit.ok).toBe(false);
    const paths = audit.absolutePathHits.map((hit) => hit.path).sort();
    expect(paths).toEqual(["about.html", "data/library.json"]);
  });

  it("fails closed for a missing output directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "classical-site-output-audit-missing-"));
    tempDirs.push(root);
    const audit = await auditSiteOutputForLocalPaths(path.join(root, "does-not-exist"));
    expect(audit.ok).toBe(false);
  });
});
