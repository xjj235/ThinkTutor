import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createTestUser } from "../factories";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { reviewRelease } from "@/lib/knowledge/review-service";
import { createVersionSnapshot } from "@/lib/knowledge/releases";
import { goldenSetSchema, goldenValidationSchema } from "@/lib/knowledge/review-schemas";
import { knowledgeManifestSchema } from "@/lib/knowledge/schemas";

const observedHashes = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/knowledge/golden-v12", () => ({
  evaluateGoldenSample: async (_manifest: unknown, versions: { contentHash: string }, sample: { id: string }) => {
    observedHashes.push(versions.contentHash);
    return { id: sample.id, passed: true, differences: [], nextGroup: null };
  },
}));
const json = (value: object) => structuredClone(value) as Prisma.InputJsonValue;
describe("frozen release calibration and publication", () => {
  afterEach(async () => { vi.unstubAllEnvs(); observedHashes.length = 0; await prisma.knowledgeRelease.deleteMany(); });
  it("calibrates and publishes one exact snapshot; edits require invalidating calibration", async () => {
    vi.stubEnv("AI_PROVIDER", "deepseek"); vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-test-key"); vi.stubEnv("AI_PSEUDONYM_SECRET", "synthetic-pseudonym-secret-at-least-32-characters");
    const teacher = await createTestUser("release-freeze-fixture", "TEACHER");
    const created = await reviewRelease(teacher, { action: "CREATE" });
    const manifest = buildV12Manifest();
    const now = new Date().toISOString();
    for (const rule of manifest.v12!.pedagogyRules) { rule.verifiedBy = teacher.id; rule.verifiedAt = now; }
    const sources = manifest.knowledgeUnits.map((u) => ({ unitId: u.id, title: "Synthetic source", author: "Test fixture", year: 2026, location: "Test-only", checksum: "c".repeat(64), verifiedBy: teacher.id, verifiedAt: now }));
    const golden = goldenSetSchema.parse(Array.from({ length: 20 }, (_, i) => ({ id: `sample-${i}`, studentAnswer: `工程合成回答样例第${i}条，不是真实教师确认的教学证据。`, targetId: "C_SR_001", expectedEvidenceIds: [], expectedErrorIds: Object.keys(manifest.v12!.errors), expectedGapIds: Object.keys(manifest.v12!.gaps), expectedLevel: ["L1", "L2", "L3", "L4"][i % 4], scenarios: ["HINT_CORRECTION", "COUNTEREXAMPLE", "FLUENT_WRONG", "INSUFFICIENT_EVIDENCE", "UNSEEN_PASS", "UNSEEN_FAIL"], dimensionAnchors: { conceptCompleteness: 0, logicCompleteness: 0, expressionClarity: 0, exampleAbility: 0, transferAbility: 0 }, verifiedBy: teacher.id, verifiedAt: now })));
    // Synthetic release and evaluator fixtures exercise gates, not live model accuracy.
    await prisma.knowledgeRelease.update({ where: { id: created.id }, data: { manifest: json(manifest), sourceReviews: json(sources), goldenSet: json(golden) } });
    await expect(reviewRelease(teacher, { action: "VALIDATE_MODEL", version: created.version })).rejects.toMatchObject({ code: "CONFLICT" });
    let release = await reviewRelease(teacher, { action: "FREEZE", version: created.version });
    const hash = release.contentHash;
    expect(release.status).toBe("FROZEN");
    expect(knowledgeManifestSchema.parse(release.manifest).sources).toHaveLength(21);
    await expect(reviewRelease(teacher, { action: "REMOVE_GOLDEN", version: release.version, sampleId: golden[0].id })).rejects.toMatchObject({ code: "CONFLICT" });
    release = await reviewRelease(teacher, { action: "VALIDATE_MODEL", version: release.version });
    expect(observedHashes).toHaveLength(20); expect(new Set(observedHashes)).toEqual(new Set([hash]));
    const validation = goldenValidationSchema.parse(release.modelValidation);
    expect(validation.releaseId).toBe(release.id); expect(validation.contentHash).toBe(hash);
    await prisma.knowledgeRelease.update({ where: { id: release.id }, data: { modelValidation: json({ ...validation, contentHash: "0".repeat(64) }) } });
    await expect(reviewRelease(teacher, { action: "REVIEW", version: release.version })).rejects.toMatchObject({ code: "CONFLICT" });
    await prisma.knowledgeRelease.update({ where: { id: release.id }, data: { modelValidation: json(validation) } });
    release = await reviewRelease(teacher, { action: "REVIEW", version: release.version });
    release = await reviewRelease(teacher, { action: "PUBLISH", version: release.version });
    expect(release.status).toBe("PUBLISHED"); expect(release.contentHash).toBe(hash);
    expect(createVersionSnapshot(knowledgeManifestSchema.parse(release.manifest)).contentHash).toBe(hash);
    await expect(reviewRelease(teacher, { action: "UNFREEZE", version: release.version })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
