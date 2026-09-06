import { knowledgeManifests } from "../src/lib/knowledge/static-manifests";
import { validateKnowledgeManifests } from "../src/lib/knowledge/schemas";

const result = validateKnowledgeManifests(knowledgeManifests);

if (result.errors.length > 0) {
  console.error("Knowledge validation failed:");
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}

const unitCount = result.manifests.reduce((total, manifest) => total + manifest.knowledgeUnits.length, 0);
const questionCount = result.manifests.reduce((total, manifest) => total + manifest.socraticQuestions.length + manifest.diagnosticQuestions.length, 0);
const misconceptionCount = result.manifests.reduce((total, manifest) => total + manifest.misconceptions.length, 0);
const caseCount = result.manifests.reduce((total, manifest) => total + manifest.cases.length, 0);
console.log(`Knowledge validation passed: ${result.manifests.length} manifest(s), ${unitCount} knowledge unit(s), ${misconceptionCount} misconception(s), ${questionCount} question(s), ${caseCount} case(s).`);