import { AppError } from "./errors";

/** A browser answer belongs to the revision whose question the student saw. */
export function assertExpectedSessionVersion(session: { version: number }, expectedVersion?: number): void {
  if (expectedVersion !== undefined && session.version !== expectedVersion) {
    throw new AppError("CONFLICT", "当前研习进度已更新，请同步最新进度后再作答。", 409, true);
  }
}
