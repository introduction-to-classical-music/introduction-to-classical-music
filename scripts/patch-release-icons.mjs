import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ResEdit from "resedit";

const require = createRequire(import.meta.url);
const { version: appVersion } = require("../package.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const iconPath = path.join(repoRoot, "apps", "desktop", "assets", "app-icon.ico");
const unpackedRoot = path.join(repoRoot, "output", "releases", "win-unpacked");

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveCandidateExecutables() {
  const entries = await readdir(unpackedRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(unpackedRoot, entry.name))
    .filter((entryPath) => entryPath.toLowerCase().endsWith(".exe"))
    .filter((entryPath) => !entryPath.toLowerCase().includes("uninstall"));
}

async function patchExecutableIcon(executablePath, iconData) {
  const executableData = await readFile(executablePath);
  const exe = ResEdit.NtExecutable.from(executableData);
  const resources = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(iconData);
  const iconGroupEntries = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  const iconGroupTargets =
    iconGroupEntries.length === 0 ? [{ id: 101, lang: 1033 }] : iconGroupEntries.map((entry) => ({ id: entry.id, lang: entry.lang }));

  for (const target of iconGroupTargets) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      target.id,
      target.lang,
      iconFile.icons.map((item) => item.data),
    );
  }

  resources.outputResource(exe);
  await writeFile(executablePath, Buffer.from(exe.generate()));
}

async function patchExecutableVersion(executablePath) {
  const executableData = await readFile(executablePath);
  const exe = ResEdit.NtExecutable.from(executableData);
  const resources = ResEdit.NtExecutableResource.from(exe);
  const versionInfoList = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if (versionInfoList.length === 0) {
    throw new Error(`No version info resource found in ${executablePath}`);
  }
  const versionInfo = versionInfoList[0];
  const languages = versionInfo.getAllLanguagesForStringValues();
  const language = languages[0]?.lang ?? 1033;
  versionInfo.setFileVersion(appVersion, language);
  versionInfo.setProductVersion(appVersion, language);
  versionInfo.setStringValues(
    { lang: language, codepage: 1200 },
    {
      FileDescription: "Windows-first desktop edition for building, maintaining, and browsing local classical music libraries.",
      ProductName: "不全书",
      ProductVersion: appVersion,
      FileVersion: appVersion,
      CompanyName: "Introduction to Classical Music Contributors",
      LegalCopyright: "Copyright © 2026 Introduction to Classical Music Contributors",
      OriginalFilename: path.basename(executablePath),
      InternalName: "buquanshu",
    },
  );
  versionInfo.outputToResourceEntries(resources.entries);
  resources.outputResource(exe);
  await writeFile(executablePath, Buffer.from(exe.generate()));
}

async function main() {
  const iconData = await readFile(iconPath);
  const candidateExecutables = await resolveCandidateExecutables();
  const patched = [];

  for (const executablePath of candidateExecutables) {
    if (!(await pathExists(executablePath))) {
      continue;
    }

    await patchExecutableIcon(executablePath, iconData);
    await patchExecutableVersion(executablePath);
    patched.push(path.relative(repoRoot, executablePath));
  }

  if (patched.length === 0) {
    const releaseFiles = await readdir(unpackedRoot, { withFileTypes: true }).catch(() => []);
    throw new Error(
      `No unpacked release executables were found to patch. Looked in ${path.relative(repoRoot, unpackedRoot)}. Available entries: ${releaseFiles
        .map((item) => item.name)
        .join(", ")}`,
    );
  }

  console.log(`Patched unpacked release icons: ${patched.join(", ")}`);
}

await main();
