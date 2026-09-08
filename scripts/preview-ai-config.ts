import { z } from "zod";

const previewAIConfigSchema = z.object({
  PREVIEW_AI_PROVIDER: z.enum(["mock", "deepseek"]).default("mock"),
  DEEPSEEK_API_KEY: z.string().optional(),
  AI_PSEUDONYM_SECRET: z.string().optional(),
}).superRefine((config, context) => {
  if (config.PREVIEW_AI_PROVIDER !== "deepseek") return;
  if (!config.DEEPSEEK_API_KEY?.trim()) context.addIssue({ code: "custom", path: ["DEEPSEEK_API_KEY"], message: "Real-model preview requires DEEPSEEK_API_KEY." });
  if ((config.AI_PSEUDONYM_SECRET?.trim().length ?? 0) < 32) context.addIssue({ code: "custom", path: ["AI_PSEUDONYM_SECRET"], message: "Real-model preview requires a dedicated pseudonym secret of at least 32 characters." });
});

export function resolvePreviewAI(environment: Partial<NodeJS.ProcessEnv>) {
  const config = previewAIConfigSchema.parse(environment);
  return {
    AI_PROVIDER: config.PREVIEW_AI_PROVIDER,
    AI_PSEUDONYM_SECRET: config.PREVIEW_AI_PROVIDER === "deepseek"
      ? config.AI_PSEUDONYM_SECRET!.trim()
      : "local-preview-ai-pseudonym-secret-at-least-32-characters",
  };
}
