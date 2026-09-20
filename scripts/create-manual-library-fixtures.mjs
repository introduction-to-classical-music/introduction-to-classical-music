import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";

const root = path.resolve("docs/manual-fixtures");
const panel = (text = "") => ({ text, articleId: "", collectionLinks: [] });
const named = (id, name, roles, extra = {}) => ({
  id, slug: id, name, nameLatin: "", country: "", countries: [], avatarSrc: "", aliases: [], sortKey: id,
  summary: "", roles, infoPanel: panel(), imageSourceUrl: "", imageSourceKind: "", imageAttribution: "", imageUpdatedAt: "", ...extra,
});
const group = (id, composerId, title) => ({ id, composerId, title, slug: id, path: [title], sortKey: id });
const work = (id, composerId, groupId, title, extra = {}) => ({
  id, composerId, groupIds: [groupId], slug: id, title, titleLatin: "", aliases: [], catalogue: "", summary: "",
  infoPanel: panel(), sortKey: id, updatedAt: "2026-09-16", ...extra,
});
const recording = (id, workId, title, conductorId, extra = {}) => ({
  id, workId, slug: id, title, workTypeHint: "unknown", sortKey: id, isPrimaryRecommendation: false,
  updatedAt: "2026-09-16", images: [], credits: [{ role: "conductor", personId: conductorId, displayName: conductorId, label: "" }],
  links: [], notes: "", performanceDateText: "", venueText: "", albumTitle: "", label: "", releaseDate: "", infoPanel: panel(), ...extra,
});

const commonComposer = named("composer-shared", "共享作曲家", ["composer"]);
const commonConductor = named("person-shared-conductor", "共享指挥", ["conductor"]);
const commonGroup = group("group-shared", commonComposer.id, "共享作品组");
const commonWork = work("work-unchanged", commonComposer.id, commonGroup.id, "完全相同作品");
const commonRecording = recording("recording-unchanged", commonWork.id, "完全相同版本", commonConductor.id);

const libraryA = {
  composers: [commonComposer, named("composer-a-only", "A 独有作曲家", ["composer"])],
  people: [commonConductor, named("person-conflict", "冲突人物-A", ["soloist"], { country: "法国", countries: ["法国"], summary: "A 方人物说明" }), named("person-a-only", "A 独有人物", ["orchestra"])],
  workGroups: [commonGroup, group("group-conflict", commonComposer.id, "冲突作品组-A"), group("group-a-only", "composer-a-only", "A 独有作品组")],
  works: [commonWork, work("work-conflict", commonComposer.id, "group-conflict", "冲突作品-A", { summary: "A 方作品说明" }), work("work-a-only", "composer-a-only", "group-a-only", "A 独有作品")],
  recordings: [
    commonRecording,
    recording("recording-conflict", "work-conflict", "冲突版本-A", commonConductor.id, {
      notes: "A 方备注",
      images: [{ src: "/library-assets/managed/manual-fixture/library-a-asset.txt", alt: "A 封面复测资源", kind: "cover" }],
      links: [{ platform: "other", url: "https://example.com/a", localPath: "", title: "A 链接", linkType: "external", visibility: "public" }],
    }),
    recording("recording-a-only", "work-a-only", "A 独有版本", commonConductor.id),
  ],
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const libraryB = clone(libraryA);
libraryB.composers = libraryB.composers.filter((item) => item.id !== "composer-a-only");
libraryB.composers.push(named("composer-b-only", "B 独有作曲家", ["composer"]));
libraryB.people = libraryB.people.filter((item) => item.id !== "person-a-only");
Object.assign(libraryB.people.find((item) => item.id === "person-conflict"), { name: "冲突人物-B", country: "德国", countries: ["德国"], summary: "B 方人物说明" });
libraryB.people.push(named("person-b-only", "B 独有人物", ["instrumentalist"]));
libraryB.workGroups = libraryB.workGroups.filter((item) => item.id !== "group-a-only");
Object.assign(libraryB.workGroups.find((item) => item.id === "group-conflict"), { title: "冲突作品组-B", path: ["冲突作品组-B"] });
libraryB.workGroups.push(group("group-b-only", "composer-b-only", "B 独有作品组"));
libraryB.works = libraryB.works.filter((item) => item.id !== "work-a-only");
Object.assign(libraryB.works.find((item) => item.id === "work-conflict"), { title: "冲突作品-B", summary: "B 方作品说明" });
libraryB.works.push(work("work-b-only", "composer-b-only", "group-b-only", "B 独有作品"));
libraryB.recordings = libraryB.recordings.filter((item) => item.id !== "recording-a-only");
Object.assign(libraryB.recordings.find((item) => item.id === "recording-conflict"), {
  title: "冲突版本-B", notes: "B 方备注",
  images: [{ src: "/library-assets/managed/manual-fixture/library-b-asset.txt", alt: "B 封面复测资源", kind: "cover" }],
  links: [{ platform: "other", url: "https://example.com/b", localPath: "", title: "B 链接", linkType: "external", visibility: "public" }],
});
libraryB.recordings.push(recording("recording-b-only", "work-b-only", "B 独有版本", commonConductor.id));

const variants = { "library-a": libraryA, "library-b": libraryB };
await mkdir(root, { recursive: true });
for (const [name, library] of Object.entries(variants)) {
  const compressedPath = path.join(root, `${name}.icmlibrary`);
  const dir = path.join(root, `${name}-directory.icmlibrary`);
  await rm(compressedPath, { force: true });
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, "content", "library"), { recursive: true });
  await mkdir(path.join(dir, "content", "site"), { recursive: true });
  await mkdir(path.join(dir, "assets", "managed", "manual-fixture"), { recursive: true });
  const manifest = { schemaVersion: "library-bundle-v1", libraryId: name, libraryName: name, createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z", appMinVersion: "0.1.0" };
  await writeFile(path.join(dir, "library.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const fileNames = { composers: "composers", people: "people", workGroups: "work-groups", works: "works", recordings: "recordings" };
  for (const [key, value] of Object.entries(library)) await writeFile(path.join(dir, "content", "library", `${fileNames[key]}.json`), `${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path.join(dir, "content", "library", "person-links.json"), '{\n  "canonicalPersonLinks": {}\n}\n');
  await writeFile(path.join(dir, "content", "library", "review-queue.json"), "[]\n");
  await writeFile(path.join(dir, "content", "library", "entity-vitals-review.json"), "[]\n");
  await writeFile(path.join(dir, "content", "site", "config.json"), `${JSON.stringify({ title: `${name} 复测站点` }, null, 2)}\n`);
  await writeFile(path.join(dir, "content", "site", "articles.json"), "[]\n");
  await writeFile(path.join(dir, "assets", "managed", "manual-fixture", `${name}-asset.txt`), `${name} fixture asset\n`);
  const archive = new AdmZip();
  archive.addLocalFile(path.join(dir, "library.manifest.json"));
  archive.addLocalFolder(path.join(dir, "content"), "content");
  archive.addLocalFolder(path.join(dir, "assets"), "assets");
  await archive.writeZipPromise(compressedPath, { overwrite: true });
}
