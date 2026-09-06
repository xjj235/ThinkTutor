import systemicRiskManifest from "../../../knowledge/courses/financial-risk-management/systemic-risk/manifest.json";
import { validateKnowledgeManifests } from "./schemas";
import { buildV12Manifest } from "./v12-resources";

const validation = validateKnowledgeManifests([systemicRiskManifest, buildV12Manifest()]);

if (validation.errors.length > 0) {
  throw new Error(`Invalid knowledge manifests:\n${validation.errors.join("\n")}`);
}

export const knowledgeManifests = validation.manifests;
