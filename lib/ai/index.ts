import "server-only";

import { MockAIProvider } from "./mock-provider";
import { OpenAIProvider } from "./openai-provider";
import type { AIProvider } from "./types";

export function getAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER ?? "mock";

  if (provider === "openai") {
    return new OpenAIProvider();
  }

  if (provider === "mock") {
    return new MockAIProvider();
  }

  return new MockAIProvider();
}

export type { AIProvider } from "./types";
