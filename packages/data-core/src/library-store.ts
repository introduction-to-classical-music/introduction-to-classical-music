import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { writeFileAtomic, writeJsonFileAtomic } from "./atomic-file.js";
import { validateArticles, type Article } from "./articles.js";
import { LIBRARY_COMMIT_FILE_NAME } from "./library-state-files.js";
import { buildIndexes, type PersonLinkConfig } from "./indexes.js";
import { validateLibrary, type InfoPanel, type LibraryData, type ResourceLink } from "../../shared/src/schema.js";
import { getRuntimePaths } from "./app-paths.js";
import {
  countLocalOnlyResourceLinks,
  resolveIncludeLocalOnlyLinks,
  resolveSiteOutputMode,
  sanitizeResourceLinksForSiteOutput,
  type SiteOutputMode,
} from "./resource-links.js";

const siteConfigDefaults: {
  title: string;
  subtitle: string;
  description: string;
  heroIntro: string;
  composerDirectoryIntro: string;
  conductorDirectoryIntro: string;
  searchIntro: string;
  about: string[];
  contact: {
    label: string;
    value: string;
  };
  copyrightNotice: string;
  lastImportedAt: string;
} = {
  title: "不全书",
  subtitle: "古典音乐资料库与本地站点",
  description: "用于维护本地古典音乐资料库、构建静态站点并统一管理条目、专栏和版本资源的 Windows 项目。",
  heroIntro: "默认资料库是一个空库，只附带《不全书使用手册》专栏，便于你从零开始维护自己的作曲家、作品、人物、团体、版本与专栏内容。",
  composerDirectoryIntro: "",
  conductorDirectoryIntro: "",
  searchIntro: "",
  about: [
    "不全书是一个面向古典音乐整理、维护与浏览的本地资料库项目。",
    "站点以作曲家、作品、人物、团体与版本为主轴，帮助使用者持续积累自己的收听目录与导览内容。",
    "公共默认库不包含开发者个人资料库，只提供空库结构和使用手册专栏。"
  ],
  contact: {
    label: "",
    value: ""
  },
  copyrightNotice: "站点仅提供导览说明与外部资源链接，不存储音视频文件；相关内容版权归原权利人所有。",
  lastImportedAt: ""
};

export type SiteConfig = typeof siteConfigDefaults;
export type ReviewQueueEntry = {
  entityId: string;
  entityType: "work" | "recording" | "person" | "composer";
  issue: string;
  sourcePath?: string;
  note?: string;
};

function getFileMap() {
  const runtimePaths = getRuntimePaths();
  return {
    composers: path.join(runtimePaths.library.contentLibraryDir, "composers.json"),
    people: path.join(runtimePaths.library.contentLibraryDir, "people.json"),
    personLinks: path.join(runtimePaths.library.contentLibraryDir, "person-links.json"),
    workGroups: path.join(runtimePaths.library.contentLibraryDir, "work-groups.json"),
    works: path.join(runtimePaths.library.contentLibraryDir, "works.json"),
    recordings: path.join(runtimePaths.library.contentLibraryDir, "recordings.json"),
    reviewQueue: path.join(runtimePaths.library.contentLibraryDir, "review-queue.json"),
    site: path.join(runtimePaths.library.contentSiteDir, "config.json"),
    articles: path.join(runtimePaths.library.contentSiteDir, "articles.json"),
    generatedLibrary: path.join(runtimePaths.library.runtimeGeneratedDir, "library.json"),
    generatedIndexes: path.join(runtimePaths.library.runtimeGeneratedDir, "indexes.json"),
    generatedSite: path.join(runtimePaths.library.runtimeGeneratedDir, "site.json"),
    generatedArticles: path.join(runtimePaths.library.runtimeGeneratedDir, "articles.json"),
  } as const;
}

async function ensureDirectories() {
  const runtimePaths = getRuntimePaths();
  await fs.mkdir(runtimePaths.library.contentLibraryDir, { recursive: true });
  await fs.mkdir(runtimePaths.library.contentSiteDir, { recursive: true });
  await fs.mkdir(runtimePaths.library.runtimeGeneratedDir, { recursive: true });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await writeJsonFileAtomic(filePath, value);
}

// --- Crash-safe library saves (F16) ---------------------------------------
//
// The five entity files form one logical unit. A save now:
//   1. snapshots the current files into a rolling transaction directory,
//   2. writes each new file atomically (tmp + fsync + rename),
//   3. records a commit marker with per-file digests.
// `recoverLibraryFromInterruptedSave()` restores the newest complete snapshot
// when the marker does not match the files (crash between file writes), so a
// restart loads a consistent library instead of a mixed half-save.

const LIBRARY_ENTITY_FILE_NAMES = [
  "composers.json",
  "people.json",
  "work-groups.json",
  "works.json",
  "recordings.json",
] as const;
const LIBRARY_TRANSACTION_SCHEMA_VERSION = "library-transaction-v1";
const LIBRARY_COMMIT_SCHEMA_VERSION = "library-commit-v1";
const LIBRARY_TRANSACTION_RETENTION = 5;
const LIBRARY_FAULT_INJECTION_ENV = "ICM_TEST_FAULT_AFTER_LIBRARY_FILE_WRITES";

type LibraryFileDigest = {
  name: string;
  sha256: string;
};

type LibraryTransactionManifest = {
  schemaVersion: string;
  transactionId: string;
  createdAt: string;
  files: LibraryFileDigest[];
};

export type LibraryCommitRecord = {
  schemaVersion: string;
  transactionId: string;
  createdAt: string;
  files: LibraryFileDigest[];
  recoveredAt?: string;
};

export type LibraryRecoveryResult = {
  status: "consistent" | "recovered" | "no-commit-record" | "unrecoverable";
  transactionId?: string;
  checkedFiles: number;
};

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Rolling snapshot directory (outside the library content tree). */
export function getLibraryTransactionRootPath() {
  const runtimePaths = getRuntimePaths();
  if (runtimePaths.mode === "bundle") {
    return path.join(path.dirname(runtimePaths.library.rootDir), "backups", "library-transactions");
  }
  // Development/legacy mode keeps the repository itself clean (output/ is ignored).
  return path.join(runtimePaths.library.rootDir, "output", "backups", "library-transactions");
}

function getLibraryCommitPath() {
  const runtimePaths = getRuntimePaths();
  if (runtimePaths.mode === "bundle") {
    // Internal runtime state lives inside the bundle but outside `content/`, so
    // source exports (manifest/content/assets) never copy it.
    return path.join(runtimePaths.library.runtimeDir, "state", LIBRARY_COMMIT_FILE_NAME);
  }
  // Legacy/dev mode: keep bookkeeping out of the tracked repository tree.
  return path.join(runtimePaths.library.rootDir, "output", "library-state", LIBRARY_COMMIT_FILE_NAME);
}

/** Pre-rework location (inside content/library); migrated and removed on load. */
function getLegacyLibraryCommitPath() {
  return path.join(getRuntimePaths().library.contentLibraryDir, LIBRARY_COMMIT_FILE_NAME);
}

async function migrateLegacyLibraryCommitRecord() {
  const legacyPath = getLegacyLibraryCommitPath();
  let raw: string;
  try {
    raw = await fs.readFile(legacyPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  const currentPath = getLibraryCommitPath();
  try {
    await fs.access(currentPath);
  } catch {
    await writeFileAtomic(currentPath, raw);
  }
  await fs.rm(legacyPath, { force: true });
}

function getLibraryEntityFiles() {
  const runtimePaths = getRuntimePaths();
  return LIBRARY_ENTITY_FILE_NAMES.map((name) => ({
    name,
    filePath: path.join(runtimePaths.library.contentLibraryDir, name),
  }));
}

function readInjectedFaultAfterWrites() {
  if (process.env.NODE_ENV !== "test") {
    return 0;
  }
  const raw = Number(process.env[LIBRARY_FAULT_INJECTION_ENV] || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

async function createLibraryTransactionBackup(): Promise<{ transactionId: string; transactionDir: string }> {
  const transactionId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const transactionDir = path.join(getLibraryTransactionRootPath(), transactionId);
  const filesDir = path.join(transactionDir, "files");
  await fs.mkdir(filesDir, { recursive: true });

  const files: LibraryFileDigest[] = [];
  for (const entityFile of getLibraryEntityFiles()) {
    let content: string;
    try {
      content = await fs.readFile(entityFile.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    await writeFileAtomic(path.join(filesDir, entityFile.name), content);
    files.push({ name: entityFile.name, sha256: sha256Text(content) });
  }

  const manifest: LibraryTransactionManifest = {
    schemaVersion: LIBRARY_TRANSACTION_SCHEMA_VERSION,
    transactionId,
    createdAt: new Date().toISOString(),
    files,
  };
  // The manifest is written last so an interrupted backup never looks complete.
  await writeJsonFileAtomic(path.join(transactionDir, "manifest.json"), manifest);
  return { transactionId, transactionDir };
}

async function listLibraryTransactionDirectories() {
  try {
    const entries = await fs.readdir(getLibraryTransactionRootPath(), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(getLibraryTransactionRootPath(), entry.name))
      .sort()
      .reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function pruneLibraryTransactions() {
  const directories = await listLibraryTransactionDirectories();
  for (const directory of directories.slice(LIBRARY_TRANSACTION_RETENTION)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function readLibraryCommitRecord(): Promise<LibraryCommitRecord | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(getLibraryCommitPath(), "utf8")) as LibraryCommitRecord;
    if (!parsed || !Array.isArray(parsed.files)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function computeLibraryEntityDigests() {
  const digests = new Map<string, string>();
  for (const entityFile of getLibraryEntityFiles()) {
    try {
      digests.set(entityFile.name, sha256Text(await fs.readFile(entityFile.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return digests;
}

function isLibraryRecordConsistent(record: LibraryCommitRecord, digests: Map<string, string>) {
  const recordedNames = new Set(record.files.map((file) => file.name));
  if (recordedNames.size !== digests.size) {
    return false;
  }
  for (const [name, digest] of digests) {
    if (!recordedNames.has(name)) {
      return false;
    }
  }
  return record.files.every((file) => digests.get(file.name) === file.sha256);
}

async function readTransactionManifest(directory: string): Promise<LibraryTransactionManifest | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")) as LibraryTransactionManifest;
    if (!parsed || parsed.schemaVersion !== LIBRARY_TRANSACTION_SCHEMA_VERSION || !Array.isArray(parsed.files)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function findLatestCompleteTransaction() {
  for (const directory of await listLibraryTransactionDirectories()) {
    const manifest = await readTransactionManifest(directory);
    if (!manifest) {
      continue;
    }
    let complete = true;
    for (const file of manifest.files) {
      try {
        const content = await fs.readFile(path.join(directory, "files", file.name), "utf8");
        if (sha256Text(content) !== file.sha256) {
          complete = false;
          break;
        }
      } catch {
        complete = false;
        break;
      }
    }
    if (complete) {
      return { directory, manifest };
    }
  }
  return null;
}

async function restoreLibraryFromTransaction(directory: string, manifest: LibraryTransactionManifest) {
  const restoreByName = new Map(manifest.files.map((file) => [file.name, file.sha256]));
  for (const entityFile of getLibraryEntityFiles()) {
    const expectedDigest = restoreByName.get(entityFile.name);
    if (!expectedDigest) {
      await fs.rm(entityFile.filePath, { force: true });
      continue;
    }
    const content = await fs.readFile(path.join(directory, "files", entityFile.name), "utf8");
    if (sha256Text(content) !== expectedDigest) {
      throw new Error(`Corrupted library transaction backup: ${path.join(directory, "files", entityFile.name)}`);
    }
    await writeFileAtomic(entityFile.filePath, content);
  }
  const record: LibraryCommitRecord = {
    schemaVersion: LIBRARY_COMMIT_SCHEMA_VERSION,
    transactionId: manifest.transactionId,
    createdAt: new Date().toISOString(),
    files: manifest.files,
    recoveredAt: new Date().toISOString(),
  };
  await writeJsonFileAtomic(getLibraryCommitPath(), record);
}

/**
 * Recover from a crash between the five entity-file writes. Returns
 * `consistent` when the commit marker matches the files, `recovered` after
 * restoring the newest complete snapshot, and `no-commit-record` for legacy
 * libraries that were never saved through this store.
 */
export async function recoverLibraryFromInterruptedSave(): Promise<LibraryRecoveryResult> {
  await ensureDirectories();
  await migrateLegacyLibraryCommitRecord();
  const commit = await readLibraryCommitRecord();
  const digests = await computeLibraryEntityDigests();
  if (commit && isLibraryRecordConsistent(commit, digests)) {
    return { status: "consistent", transactionId: commit.transactionId, checkedFiles: digests.size };
  }

  const latest = await findLatestCompleteTransaction();
  if (latest) {
    await restoreLibraryFromTransaction(latest.directory, latest.manifest);
    return { status: "recovered", transactionId: latest.manifest.transactionId, checkedFiles: digests.size };
  }

  return { status: commit ? "unrecoverable" : "no-commit-record", checkedFiles: digests.size };
}

export async function loadLibraryFromDisk(): Promise<LibraryData> {
  await ensureDirectories();
  const recovery = await recoverLibraryFromInterruptedSave();
  if (recovery.status === "recovered") {
    console.warn(
      `[library-store] recovered library files after an interrupted save (snapshot ${recovery.transactionId ?? "unknown"})`,
    );
  } else if (recovery.status === "unrecoverable") {
    console.warn("[library-store] library commit record does not match the files and no complete backup is available");
  }
  const fileMap = getFileMap();

  return validateLibrary({
    composers: await readJsonFile(fileMap.composers, []),
    people: await readJsonFile(fileMap.people, []),
    workGroups: await readJsonFile(fileMap.workGroups, []),
    works: await readJsonFile(fileMap.works, []),
    recordings: await readJsonFile(fileMap.recordings, []),
  });
}

export async function saveLibraryToDisk(library: LibraryData) {
  await ensureDirectories();
  await migrateLegacyLibraryCommitRecord();
  const fileMap = getFileMap();
  const projectedPersonIds = new Set((library.people || []).map((person) => person.id));
  const payloads = [
    {
      name: "composers.json",
      filePath: fileMap.composers,
      value: (library.composers || []).filter((composer) => !projectedPersonIds.has(composer.id)),
    },
    { name: "people.json", filePath: fileMap.people, value: library.people },
    { name: "work-groups.json", filePath: fileMap.workGroups, value: library.workGroups },
    { name: "works.json", filePath: fileMap.works, value: library.works },
    { name: "recordings.json", filePath: fileMap.recordings, value: library.recordings },
  ];

  const transaction = await createLibraryTransactionBackup();
  const faultAfter = readInjectedFaultAfterWrites();
  const writtenFiles: LibraryFileDigest[] = [];
  try {
    for (const payload of payloads) {
      const content = `${JSON.stringify(payload.value, null, 2)}\n`;
      await writeFileAtomic(payload.filePath, content);
      writtenFiles.push({ name: payload.name, sha256: sha256Text(content) });
      if (faultAfter > 0 && writtenFiles.length >= faultAfter) {
        throw new Error(`Injected library save failure after writing ${writtenFiles.length} file(s)`);
      }
    }
    await writeJsonFileAtomic(getLibraryCommitPath(), {
      schemaVersion: LIBRARY_COMMIT_SCHEMA_VERSION,
      transactionId: transaction.transactionId,
      createdAt: new Date().toISOString(),
      files: writtenFiles,
    } satisfies LibraryCommitRecord);
  } finally {
    await pruneLibraryTransactions().catch(() => {});
  }
}

export async function loadPersonLinks(): Promise<PersonLinkConfig> {
  await ensureDirectories();
  const fileMap = getFileMap();
  const raw = await readJsonFile<Partial<PersonLinkConfig>>(fileMap.personLinks, {});
  return {
    canonicalPersonLinks: raw.canonicalPersonLinks ?? {},
  };
}

export async function savePersonLinks(config: PersonLinkConfig) {
  await ensureDirectories();
  const fileMap = getFileMap();
  await writeJsonFile(fileMap.personLinks, config);
}

export async function loadReviewQueue() {
  await ensureDirectories();
  const fileMap = getFileMap();
  return readJsonFile<ReviewQueueEntry[]>(fileMap.reviewQueue, []);
}

export async function saveReviewQueue(reviewQueue: ReviewQueueEntry[]) {
  await ensureDirectories();
  const fileMap = getFileMap();
  await writeJsonFile(fileMap.reviewQueue, reviewQueue);
}

export async function loadSiteConfig(): Promise<SiteConfig> {
  await ensureDirectories();
  const fileMap = getFileMap();
  const raw = await readJsonFile<SiteConfig>(fileMap.site, siteConfigDefaults);
  return {
    ...siteConfigDefaults,
    ...raw,
    contact: {
      ...siteConfigDefaults.contact,
      ...raw.contact,
    },
  };
}

export async function loadArticlesFromDisk(): Promise<Article[]> {
  await ensureDirectories();
  const fileMap = getFileMap();
  return validateArticles(await readJsonFile(fileMap.articles, []));
}

export async function saveArticlesToDisk(articles: Article[]) {
  await ensureDirectories();
  const fileMap = getFileMap();
  await writeJsonFile(fileMap.articles, validateArticles(articles));
}

export async function saveSiteConfig(siteConfig: SiteConfig) {
  await ensureDirectories();
  const fileMap = getFileMap();
  await writeJsonFile(fileMap.site, siteConfig);
}

export type SiteOutputOptions = {
  /** `public` (default) strips local/local-only links; `local` keeps them. */
  siteOutputMode?: SiteOutputMode;
  /** Legacy explicit override; `true` means local mode. */
  includeLocalOnlyLinks?: boolean;
  /** Deployment base path used for generated internal hrefs (W10b). */
  basePath?: string;
};

function prepareLibraryForSiteOutput(library: LibraryData, options: SiteOutputOptions = {}) {
  const siteOutputMode = resolveSiteOutputMode(options);
  const includeLocalOnly = resolveIncludeLocalOnlyLinks({ siteOutputMode, includeLocalOnly: options.includeLocalOnlyLinks });
  let strippedLocalLinks = 0;
  const sanitizeLinks = (links: ResourceLink[] = []) => {
    if (!includeLocalOnly) {
      strippedLocalLinks += countLocalOnlyResourceLinks(links);
    }
    return sanitizeResourceLinksForSiteOutput(links, { includeLocalOnly });
  };
  const sanitizeInfoPanel = (infoPanel: InfoPanel | undefined) =>
    infoPanel
      ? {
          ...infoPanel,
          collectionLinks: sanitizeLinks(infoPanel.collectionLinks || []),
        }
      : infoPanel;

  const renderableLibrary = validateLibrary({
    composers: library.composers.map((composer) => ({
      ...composer,
      infoPanel: sanitizeInfoPanel(composer.infoPanel),
    })),
    people: library.people.map((person) => ({
      ...person,
      infoPanel: sanitizeInfoPanel(person.infoPanel),
    })),
    workGroups: library.workGroups,
    works: library.works.map((work) => ({
      ...work,
      infoPanel: sanitizeInfoPanel(work.infoPanel),
    })),
    recordings: library.recordings.map((recording) => ({
      ...recording,
      links: sanitizeLinks(recording.links || []),
      infoPanel: sanitizeInfoPanel(recording.infoPanel),
    })),
  });

  return {
    siteOutputMode,
    strippedLocalLinks,
    library: renderableLibrary,
  };
}

export async function writeGeneratedArtifacts(options: SiteOutputOptions = {}) {
  const [library, site, personLinks, articles] = await Promise.all([
    loadLibraryFromDisk(),
    loadSiteConfig(),
    loadPersonLinks(),
    loadArticlesFromDisk(),
  ]);
  const prepared = prepareLibraryForSiteOutput(library, options);
  const renderableLibrary = prepared.library;
  const indexes = buildIndexes(renderableLibrary, personLinks, articles, { basePath: options.basePath });
  const fileMap = getFileMap();

  await ensureDirectories();
  await writeJsonFile(fileMap.generatedLibrary, renderableLibrary);
  await writeJsonFile(fileMap.generatedIndexes, indexes);
  await writeJsonFile(fileMap.generatedSite, site);
  await writeJsonFile(fileMap.generatedArticles, articles);

  return {
    library: renderableLibrary,
    site,
    indexes,
    articles,
    siteOutputMode: prepared.siteOutputMode,
    strippedLocalLinks: prepared.strippedLocalLinks,
  };
}

export async function readGeneratedLibrary() {
  const fileMap = getFileMap();
  return readJsonFile<LibraryData>(
    fileMap.generatedLibrary,
    validateLibrary({
      composers: [],
      people: [],
      workGroups: [],
      works: [],
      recordings: [],
    }),
  );
}

export async function readGeneratedIndexes() {
  const fileMap = getFileMap();
  return readJsonFile(
    fileMap.generatedIndexes,
    buildIndexes(
      validateLibrary({
        composers: [],
        people: [],
        workGroups: [],
        works: [],
        recordings: [],
      }),
      { canonicalPersonLinks: {} },
      [],
    ),
  );
}

export async function readGeneratedSite() {
  const fileMap = getFileMap();
  return readJsonFile<SiteConfig>(fileMap.generatedSite, siteConfigDefaults);
}

export async function readGeneratedArticles() {
  const fileMap = getFileMap();
  return validateArticles(await readJsonFile(fileMap.generatedArticles, []));
}

export function getDataPaths() {
  return getFileMap();
}
