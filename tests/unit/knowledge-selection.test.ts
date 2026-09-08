import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as environment from "@/lib/env";
import { findKnowledgeManifest } from "@/lib/knowledge/releases";

describe("knowledge selection from resolved learning context", () => {
  beforeEach(() => vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true"));
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("uses the chapter when a course goal has a generic title", async () => {
    expect((await findKnowledgeManifest("解释风险传播路径", { chapter: "系统性风险", objective: "解释冲击的条件、渠道和后果。" }))?.release.id).toBe("KR_SR_1_2");
  });

  it("uses an explicit learning objective without relying on the title", async () => {
    expect((await findKnowledgeManifest("解释风险传播路径", { objective: "能够用条件、传播渠道和系统后果解释系统性风险。" }))?.release.id).toBe("KR_SR_1_2");
    expect((await findKnowledgeManifest("机制分析", { chapter: "  SYSTEMIC   RISK  " }))?.release.id).toBe("KR_SR_1_2");
  });

  it("does not select systemic risk for an unrelated or merely generic risk goal", async () => {
    expect(await findKnowledgeManifest("解释风险传播路径", { objective: "说明一般事件的因果关系。" })).toBeUndefined();
    expect(await findKnowledgeManifest("概率论", { chapter: "随机变量", objective: "解释期望和方差。" })).toBeUndefined();
  });

  it("keeps the release gate when the subject is identified through context", async () => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    expect(await findKnowledgeManifest("解释风险传播路径", { chapter: "系统性风险" })).toBeUndefined();
    const config = environment.getServerEnv();
    vi.spyOn(environment, "getServerEnv").mockReturnValue({ ...config, DEPLOYMENT_ENV: "production" });
    await expect(findKnowledgeManifest("解释风险传播路径", { chapter: "系统性风险" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
