import "server-only";

import { getServerEnv } from "../env";
import { AliyunOSSProvider } from "./aliyun-oss-provider";
import { LocalStorageProvider } from "./local-provider";
import type { StorageProvider } from "./types";

let provider: StorageProvider | undefined;

export function getStorageProvider(): StorageProvider {
  if (provider) return provider;
  provider = getServerEnv().STORAGE_PROVIDER === "oss" ? new AliyunOSSProvider() : new LocalStorageProvider();
  return provider;
}

export type { StorageProvider } from "./types";
