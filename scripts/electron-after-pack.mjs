import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ResEdit from "resedit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

export default async function afterPack(context) {
  const astroTemplateSource = path.join(repoRoot, "node_modules", "astro", "templates");
  const defaultLibrarySource = path.join(repoRoot, "output", "release-default-library");
  const packagedAppDir =
    context.packager.config.asar === false
      ? path.join(context.appOutDir, "resources", "app")
      : path.join(context.appOutDir, "resources", "app.asar.unpacked");
  const astroTemplateTarget = path.join(packagedAppDir, "node_modules", "astro", "templates");
  const defaultLibraryTarget = path.join(context.appOutDir, "library");

  await mkdir(path.dirname(astroTemplateTarget), { recursive: true });
  await cp(astroTemplateSource, astroTemplateTarget, { recursive: true, force: true });
  await rm(defaultLibraryTarget, { recursive: true, force: true });
  await cp(defaultLibrarySource, defaultLibraryTarget, { recursive: true, force: true });
  await patchWindowsExecutableIcon(context);
  await patchWindowsVersionInfo(context);
}

async function patchWindowsExecutableIcon(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const executablePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const iconPath = path.join(repoRoot, "apps", "desktop", "assets", "app-icon.ico");
  const executableData = await readFile(executablePath);
  const iconData = await readFile(iconPath);
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


async function patchWindowsVersionInfo(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const executablePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const appVersion = context.packager.appInfo.version;
  const executableData = await readFile(executablePath);
  const exe = ResEdit.NtExecutable.from(executableData);
  const resources = ResEdit.NtExecutableResource.from(exe);
  const versionInfoList = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if (versionInfoList.length === 0) {
    throw new Error(`No version info resource found in ${executablePath}`);
  }
  const versionInfo = versionInfoList[0];
  const language = versionInfo.getAllLanguagesForStringValues()[0]?.lang ?? 1033;
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
