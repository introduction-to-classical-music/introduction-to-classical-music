// Write SHA256SUMS.txt / checksums.json for release artifacts (task-40).
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repoRoot, "output", "releases");
const files = [];
for (const name of (await readdir(outRoot)).sort()) {
  if (!/\.(?:exe|blockmap|yml|zip)$/i.test(name)) continue;
  const full = path.join(outRoot, name);
  if (!(await stat(full)).isFile()) continue;
  const sha256 = createHash("sha256").update(await readFile(full)).digest("hex");
  files.push({ name, sha256, size: (await stat(full)).size });
}
const lines = files.map((file) => `${file.sha256} *${file.name}`);
await writeFile(path.join(outRoot, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
await writeFile(path.join(outRoot, "checksums.json"), `${JSON.stringify({ version: pkg.version, generatedAt: new Date().toISOString(), files }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputDir: outRoot, files }, null, 2));
