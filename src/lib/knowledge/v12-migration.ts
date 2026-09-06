import type { KnowledgeRuntime } from "./runtime-schemas";
import type { LearnerState } from "../contracts";
import type { KnowledgeManifest } from "./schemas";
import { initialV12State } from "./v12-engine";
import { legacySignalMap } from "./v12-resources";

// Migration is explicit and never changes a session's pinned release.
export function migrateLegacyEvidence(runtime: KnowledgeRuntime, learner: LearnerState | null, manifest: KnowledgeManifest): KnowledgeRuntime {
  const next = structuredClone(runtime);
  const state = initialV12State();
  state.migrationLog.push(`Imported from ${runtime.versions.releaseId}; missing message evidence requires verification`);
  state.needsTeacherReview = true;
  for (const signal of [...(learner?.misconceptions ?? []), ...(learner?.gaps ?? [])]) {
    const mapped = legacySignalMap[signal] ?? (manifest.v12?.errors[signal] || manifest.v12?.gaps[signal] ? [signal] : []);
    state.migrationLog.push(mapped.length ? `${signal} -> ${mapped.join(",")}` : `${signal} -> INVALID_LEGACY_ID / NEED_VERIFY`);
  }
  for (const id of learner?.confirmedPoints ?? []) {
    if (manifest.knowledgeUnits.some((u) => u.id === id)) state.unitStates[id] = { status: "PARTIAL", evidenceRefs: [], independentEvidenceCount: 0, verificationCount: 0, questionIds: [], lastUpdatedAt: "1970-01-01T00:00:00.000Z" };
    else state.migrationLog.push(`${id} -> NEED_VERIFY`);
  }
  next.v12 = state;
  next.flags = [...new Set([...next.flags, "FLAG_NEED_VERIFY"])];
  return next;
}
