import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateLibrary, type LibraryData } from "../../shared/src/schema.js";
import { withLibraryBundleRoot } from "./library-bundle.js";

export type MergeEntityType = "composer" | "person" | "workGroup" | "work" | "recording";
export type MergeDecision = "local" | "incoming";
export type MergeResolutions = Record<string, Record<string, unknown>>;

const collections: Array<{ type: MergeEntityType; key: keyof LibraryData; label: string }> = [
  { type: "composer", key: "composers", label: "作曲家" },
  { type: "person", key: "people", label: "人物" },
  { type: "workGroup", key: "workGroups", label: "作品组" },
  { type: "work", key: "works", label: "作品" },
  { type: "recording", key: "recordings", label: "版本" },
];

function normalizeForCompare(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForCompare);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalizeForCompare(item)]));
  }
  return value;
}

function equalValue(left: unknown, right: unknown) {
  return JSON.stringify(normalizeForCompare(left)) === JSON.stringify(normalizeForCompare(right));
}

function entityMap(items: unknown[]) {
  return new Map(items.filter((item): item is Record<string, any> => Boolean(item && typeof item === "object" && "id" in item && typeof (item as { id?: unknown }).id === "string")).map((item) => [item.id as string, item]));
}

export type MergeFieldDifference = {
  path: string;
  local: unknown;
  incoming: unknown;
};

export type MergeConflict = {
  entityType: MergeEntityType;
  entityId: string;
  label: string;
  local: Record<string, unknown>;
  incoming: Record<string, unknown>;
  fields: MergeFieldDifference[];
};

export type LibraryMergeReport = {
  added: Array<{ entityType: MergeEntityType; entityId: string; label: string; incoming: Record<string, unknown> }>;
  localOnly: Array<{ entityType: MergeEntityType; entityId: string; label: string; local: Record<string, unknown> }>;
  unchanged: Array<{ entityType: MergeEntityType; entityId: string; label: string }>;
  conflicts: MergeConflict[];
  counts: Record<string, number>;
};

export function compareLibraries(local: LibraryData, incoming: LibraryData): LibraryMergeReport {
  const report: LibraryMergeReport = { added: [], localOnly: [], unchanged: [], conflicts: [], counts: {} };
  for (const { type, key, label } of collections) {
    const localItems = entityMap(local[key] as unknown[]);
    const incomingItems = entityMap(incoming[key] as unknown[]);
    for (const [entityId, localValue] of localItems) {
      if (!incomingItems.has(entityId)) report.localOnly.push({ entityType: type, entityId, label, local: localValue as Record<string, unknown> });
    }
    let added = 0;
    let unchanged = 0;
    let conflicts = 0;
    for (const [entityId, incomingValue] of incomingItems) {
      const localValue = localItems.get(entityId);
      if (!localValue) {
        report.added.push({ entityType: type, entityId, label, incoming: incomingValue as Record<string, unknown> });
        added += 1;
        continue;
      }
      const fields: MergeFieldDifference[] = [];
      const keys = new Set([...Object.keys(localValue), ...Object.keys(incomingValue)]);
      for (const field of keys) {
        if (field === "id" || equalValue(localValue[field], incomingValue[field])) continue;
        fields.push({ path: field, local: localValue[field], incoming: incomingValue[field] });
      }
      if (fields.length === 0) {
        report.unchanged.push({ entityType: type, entityId, label });
        unchanged += 1;
      } else {
        report.conflicts.push({ entityType: type, entityId, label, local: localValue as Record<string, unknown>, incoming: incomingValue as Record<string, unknown>, fields });
        conflicts += 1;
      }
    }
    report.counts[`${type}.added`] = added;
    report.counts[`${type}.unchanged`] = unchanged;
    report.counts[`${type}.conflicts`] = conflicts;
  }
  return report;
}

function applyEntityDecisions(
  local: LibraryData,
  incoming: LibraryData,
  decisions: Record<string, MergeDecision> = {},
  resolutions: MergeResolutions = {},
) {
  const next = structuredClone(local) as LibraryData;
  for (const { type, key } of collections) {
    const target = next[key] as Array<Record<string, unknown>>;
    const source = incoming[key] as Array<Record<string, unknown>>;
    const targetMap = entityMap(target);
    for (const incomingItem of source) {
      const localItem = targetMap.get(String(incomingItem.id));
      if (!localItem) {
        target.push(structuredClone(incomingItem));
        continue;
      }
      const resolutionKey = `${type}/${incomingItem.id}`;
      if (resolutions[resolutionKey]) {
        const resolvedItem = structuredClone(resolutions[resolutionKey]);
        if (resolvedItem.id !== incomingItem.id) throw new Error(`Resolved entity id cannot change: ${resolutionKey}`);
        const index = target.findIndex((item) => item.id === incomingItem.id);
        if (index >= 0) target[index] = resolvedItem;
        continue;
      }
      const merged = { ...localItem };
      for (const field of Object.keys(incomingItem)) {
        if (field === "id") continue;
        const decisionKey = `${type}/${incomingItem.id}/${field}`;
        if (decisions[decisionKey] === "incoming") merged[field] = structuredClone(incomingItem[field]);
      }
      const index = target.findIndex((item) => item.id === incomingItem.id);
      if (index >= 0) target[index] = merged;
    }
  }
  return validateLibrary(next);
}

async function readJson<T>(rootDir: string, relativePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(rootDir, relativePath), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function loadLibraryFromBundleRoot(rootDir: string): Promise<LibraryData> {
  return withLibraryBundleRoot(rootDir, async (libraryRoot) => validateLibrary({
    composers: await readJson(path.join(libraryRoot, "content"), "library/composers.json", []),
    people: await readJson(path.join(libraryRoot, "content"), "library/people.json", []),
    workGroups: await readJson(path.join(libraryRoot, "content"), "library/work-groups.json", []),
    works: await readJson(path.join(libraryRoot, "content"), "library/works.json", []),
    recordings: await readJson(path.join(libraryRoot, "content"), "library/recordings.json", []),
  }));
}

export async function mergeLibraries(
  local: LibraryData,
  incoming: LibraryData,
  decisions: Record<string, MergeDecision> = {},
  resolutions: MergeResolutions = {},
) {
  const report = compareLibraries(local, incoming);
  return { report, library: applyEntityDecisions(local, incoming, decisions, resolutions) };
}
