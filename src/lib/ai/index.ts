import "server-only";

import { AIProviderError } from "../errors";
import { DeepSeekProvider } from "./deepseek-provider";
import { MockAIProvider } from "./mock-provider";
import type { AIProvider } from "./types";

export function getAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER ?? "mock";
  if (provider === "deepseek") return new DeepSeekProvider();
  if (provider === "mock") return new MockAIProvider();
  throw new AIProviderError("AI_PROVIDER_ERROR", "AI_PROVIDER 只能是 mock 或 deepseek。", 500, false);
}

export type { AIProvider } from "./types";
