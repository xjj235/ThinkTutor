import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import raw from "../../knowledge/golden/systemic-risk/routing.json";
import { knowledgeManifests } from "@/lib/knowledge/static-manifests";
import { createVersionSnapshot } from "@/lib/knowledge/releases";
import { initialKnowledgeRuntime, normalizeSignals, selectKnowledgeAction } from "@/lib/knowledge/orchestrator";

const golden = z.object({
  reviewStatus: z.literal("PENDING_TEACHER_REVIEW"),
  scope: z.string(),
  samples: z.array(z.object({
    id: z.string(), studentAnswer: z.string().min(1), errors: z.array(z.string()), gaps: z.array(z.string()),
    expectedTarget: z.string(), expectedFlag: z.string().nullable(),
  }).strict()).min(20),
}).strict().parse(raw);

describe("pending-review golden routing fixtures (not model accuracy)", () => {
  beforeEach(() => vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true"));
  afterEach(() => vi.unstubAllEnvs());
  it.each(golden.samples)("$id routes supplied signals to $expectedTarget", (sample) => {
    const manifest = knowledgeManifests[0];
    const learner = { masteryEstimate: 0, confirmedPoints: [], misconceptions: sample.errors, gaps: sample.gaps };
    const runtime = initialKnowledgeRuntime(createVersionSnapshot(manifest));
    const action = selectKnowledgeAction(manifest, runtime, learner, 0);
    expect(action?.targetId).toBe(sample.expectedTarget);
    const signals = normalizeSignals(manifest, learner);
    if (sample.expectedFlag) expect(signals.flags).toContain(sample.expectedFlag);
    else expect(signals.flags).toEqual([]);
  });
});
