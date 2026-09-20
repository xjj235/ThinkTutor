import { z } from "zod";
import legacyRules from "../../../knowledge/courses/financial-risk-management/systemic-risk/coaching-legacy-rules.json" with { type: "json" };
import { coachingSignalSchema, coachingVerificationRuleSchema, routingExecutionSchema, type CoachingPolicy } from "./coaching-schema";

// Freeze pre-1.1 behavior for stored releases without adding fields to their content hashes.
const legacy = z.object({ routing: z.record(coachingSignalSchema, routingExecutionSchema), verification: z.array(coachingVerificationRuleSchema) }).strict().parse(legacyRules);

export function executableRoutingRules(policy: CoachingPolicy) {
  return policy.routingRules.map((rule) => {
    const execution = policy.version === "1.0" ? legacy.routing[rule.signal] : rule.execution;
    if (!execution) throw new Error(`Missing routing execution: ${rule.id}`);
    return { ...rule, execution };
  }).sort((a, b) => b.execution.priority - a.execution.priority || a.id.localeCompare(b.id));
}

export function targetVerificationRules(policy: CoachingPolicy | undefined, targetId: string | null) {
  const rules = policy && policy.version !== "1.0" ? policy.verificationRules : legacy.verification;
  if (!rules) throw new Error("Missing knowledge verification rules");
  return rules.filter((rule) => targetId !== null && rule.targetIds.includes(targetId));
}
