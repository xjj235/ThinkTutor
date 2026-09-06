import { describe, expect, it } from "vitest";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { candidateReadiness, mergeCandidateSources } from "@/lib/knowledge/release-candidate";
import { createVersionSnapshot } from "@/lib/knowledge/releases";

describe("immutable calibration candidate", () => {
  it("merges teacher provenance before hashing and never changes the hash at publication", () => {
    const manifest = buildV12Manifest();
    const sources = manifest.knowledgeUnits.map((u) => ({ unitId: u.id, title: "Synthetic test source", author: "Test fixture", year: 2026, location: "Test-only section", checksum: "b".repeat(64), verifiedBy: "test-teacher", verifiedAt: "2026-09-06T00:00:00.000Z" }));
    const frozen = mergeCandidateSources(manifest, sources);
    const hash = createVersionSnapshot(frozen).contentHash;
    expect(hash).not.toBe(createVersionSnapshot(manifest).contentHash);
    expect(createVersionSnapshot(mergeCandidateSources(frozen, sources)).contentHash).toBe(hash);
    const published = structuredClone(frozen);
    published.release.status = "published"; published.release.verifiedBy = "test-teacher"; published.release.verifiedAt = "2026-09-06T01:00:00.000Z";
    expect(createVersionSnapshot(published).contentHash).toBe(hash);
    published.knowledgeUnits[0].content += "Changed teaching content";
    expect(createVersionSnapshot(published).contentHash).not.toBe(hash);
    expect(manifest.sources).toHaveLength(8);
  });
  it("cannot substitute engineering fixtures for missing teacher requirements", () => {
    expect(candidateReadiness(buildV12Manifest(), [], []).length).toBeGreaterThanOrEqual(6);
  });
});
