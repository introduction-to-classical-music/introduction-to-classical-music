import { describe, expect, it } from "vitest";
import { compareLibraries, mergeLibraries } from "../../packages/data-core/src/library-merge.js";

const library = (overrides: Record<string, unknown> = {}) => ({
  composers: [], people: [], workGroups: [], works: [], recordings: [], ...overrides,
}) as any;

describe("library merge", () => {
  it("reports incoming and local-only entities", () => {
    const report = compareLibraries(library({ composers: [{ id: "a", name: "A" }] }), library({ composers: [{ id: "b", name: "B" }] }));
    expect(report.added.map((item) => item.entityId)).toEqual(["b"]);
    expect(report.localOnly.map((item) => item.entityId)).toEqual(["a"]);
  });

  it("keeps local conflict values by default and accepts field decisions", async () => {
    const local = library({ composers: [{ id: "a", name: "Local", slug: "a", sortKey: "a" }] });
    const incoming = library({ composers: [{ id: "a", name: "Incoming", slug: "a", sortKey: "a" }] });
    const defaultResult = await mergeLibraries(local, incoming);
    expect(defaultResult.library.composers[0].name).toBe("Local");
    const selectedResult = await mergeLibraries(local, incoming, { "composer/a/name": "incoming" });
    expect(selectedResult.library.composers[0].name).toBe("Incoming");
  });

  it("accepts a fully edited conflict resolution", async () => {
    const local = library({ composers: [{ id: "a", name: "Local", slug: "a", sortKey: "a", summary: "local" }] });
    const incoming = library({ composers: [{ id: "a", name: "Incoming", slug: "a", sortKey: "a", summary: "incoming" }] });
    const resolved = { id: "a", name: "Edited", slug: "a", sortKey: "a", summary: "manual" };
    const result = await mergeLibraries(local, incoming, {}, { "composer/a": resolved });
    expect(result.library.composers[0].name).toBe("Edited");
    expect(result.library.composers[0].summary).toBe("manual");
  });
});
