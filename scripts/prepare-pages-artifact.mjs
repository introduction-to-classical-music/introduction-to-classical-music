import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(process.env.ICM_REPO_ROOT || process.cwd());
const sourceDir = path.join(repoRoot, "output", "site");
const artifactDir = path.join(repoRoot, "output", "site-pages");

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(absolutePath);
      }
      return [absolutePath];
    }),
  );
  return files.flat();
}

function normalizeForBaseUrl(value, basePath) {
  if (typeof value !== "string") {
    return value;
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return value;
  }
  return `${basePath}${value.slice(1)}`;
}

function patchHtmlDocument(content, basePath) {
  const next = content
    .replace(/\b(href|src|action)=(["'])(\/[^"']*)\2/g, (_m, attr, quote, url) => {
      return `${attr}=${quote}${normalizeForBaseUrl(url, basePath)}${quote}`;
    })
    .replace(/\burl\((['"]?)(\/[^)"']*)\1\)/g, (_m, quote, url) => {
      const next = normalizeForBaseUrl(url, basePath);
      return `url(${quote}${next}${quote})`;
    });

  // Patch JSON-like href values in inline scripts (e.g. search index data).
  return next.replace(/"href":"(\/[^"]*)"/g, (_m, url) => {
    return `"href":"${normalizeForBaseUrl(url, basePath)}"`;
  });
}

function patchJsonValue(value, basePath) {
  if (Array.isArray(value)) {
    return value.map((item) => patchJsonValue(item, basePath));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, patchJsonValue(child, basePath)]),
    );
  }
  return normalizeForBaseUrl(value, basePath);
}

async function patchArtifacts(rootDir, basePath) {
  const files = await walkFiles(rootDir);
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (extension === ".html") {
      const content = await readFile(file, "utf8");
      const patched = patchHtmlDocument(content, basePath);
      if (patched !== content) {
        await writeFile(file, patched, "utf8");
      }
      continue;
    }

    if (extension === ".json") {
      const text = await readFile(file, "utf8");
      try {
        const parsed = JSON.parse(text);
        const patched = patchJsonValue(parsed, basePath);
        const nextText = `${JSON.stringify(patched, null, 2)}\n`;
        if (nextText !== text) {
          await writeFile(file, nextText, "utf8");
        }
      } catch {
        // Keep non-JSON files untouched.
      }
    }
  }
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY || "";
  const repoNameFromEnv = repository.includes("/") ? repository.split("/")[1] : "";
  const repoName = process.env.ICM_PAGES_REPO_NAME || repoNameFromEnv || path.basename(repoRoot);
  const basePath = `/${repoName}/`;

  const sourceStats = await stat(sourceDir).catch(() => null);
  if (!sourceStats?.isDirectory()) {
    throw new Error(`Site output directory not found: ${sourceDir}`);
  }

  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(path.dirname(artifactDir), { recursive: true });
  await cp(sourceDir, artifactDir, { recursive: true, force: true });
  await patchArtifacts(artifactDir, basePath);

  await writeFile(path.join(artifactDir, ".nojekyll"), "\n", "utf8");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
