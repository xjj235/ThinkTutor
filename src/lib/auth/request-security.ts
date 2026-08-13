import "server-only";

import { getServerEnv } from "../env";
import { AppError } from "../errors";

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) {
    if (getServerEnv().NODE_ENV === "production") {
      throw new AppError("FORBIDDEN", "缺少来源校验信息。", 403);
    }
    return;
  }
  const expected = new URL(getServerEnv().APP_URL).origin;
  if (new URL(origin).origin !== expected) {
    throw new AppError("FORBIDDEN", "请求来源不受信任。", 403);
  }
}
