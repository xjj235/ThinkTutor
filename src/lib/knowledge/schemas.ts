import { z } from "zod";
import { questionTypeValues, singleQuestionTextSchema } from "../contracts";
import { v12ResourcesSchema } from "./v12-schema";

const statusSchema = z.enum(["draft", "reviewed", "published", "archived"]);
const visibilitySchema = z.enum(["STUDENT", "TEACHER", "AI_INTERNAL", "ADMIN"]);
const idSchema = z.string().trim().min(2).max(80);
const versionSchema = z.string().trim().regex(/^\d+\.\d+$/u, "version must use major.minor format.");

export const knowledgeUnitTypeSchema = z.enum([
  "definition",
  "concept",
  "mechanism",
  "comparison",
  "dimension",
  "feedback_loop",
  "regulation",
]);

export const knowledgeManifestSchema = z
  .object({
    v12: v12ResourcesSchema.optional(),
    release: z.object({
      id: idSchema,
      status: statusSchema,
      verifiedBy: z.string().min(1).nullable(),
      verifiedAt: z.iso.datetime().nullable(),
      publishNote: z.string().max(1000),
    }).strict(),
    course: z.object({ code: idSchema, title: z.string().min(1).max(120), version: versionSchema, status: statusSchema }).strict(),
    chapter: z.object({ code: idSchema, title: z.string().min(1).max(160), version: versionSchema, status: statusSchema }).strict(),
    knowledgePoint: z.object({ code: idSchema, title: z.string().min(1).max(160), description: z.string().min(1).max(500), version: versionSchema, status: statusSchema }).strict(),
    sources: z.array(z.object({
      id: idSchema,
      sourceType: z.enum(["teacher_material", "textbook", "official", "paper", "internal_design", "web"]),
      title: z.string().min(1).max(200),
      author: z.string().max(120).optional(),
      year: z.number().int().min(1900).max(2200).optional(),
      fileId: z.string().max(120).optional(),
      version: versionSchema,
      location: z.string().min(1).max(300),
      checksum: z.string().min(1).max(160),
      status: statusSchema,
    }).strict()).min(1),
    knowledgeUnits: z.array(z.object({
      id: idSchema,
      code: idSchema,
      title: z.string().min(1).max(160),
      type: knowledgeUnitTypeSchema,
      summary: z.string().min(1).max(500),
      content: z.string().min(1).max(1000),
      difficulty: z.number().int().min(1).max(5),
      learningRequirement: z.string().min(1).max(300),
      prerequisites: z.array(idSchema).max(10),
      relations: z.array(z.object({
        type: z.enum(["prerequisite", "causes", "amplifies", "contrasts_with", "example_of", "related_to", "may_lead_to"]),
        target: idSchema,
      }).strict()).max(10),
      misconceptions: z.array(idSchema).max(10),
      sourceRefs: z.array(z.object({
        sourceId: idSchema,
        sourceLocator: z.string().min(1).max(200),
        confidence: z.number().min(0).max(1),
      }).strict()).min(1),
      visibility: visibilitySchema,
      version: versionSchema,
      status: statusSchema,
    }).strict()).min(1),
    misconceptions: z.array(z.object({
      id: idSchema,
      category: z.string().min(1).max(80),
      description: z.string().min(1).max(300),
      severity: z.enum(["low", "medium", "high"]),
      targetUnits: z.array(idSchema).min(1).max(10),
      recommendedQuestionType: z.enum(questionTypeValues),
      triggers: z.array(z.string().min(1).max(120)).max(10),
      status: statusSchema,
    }).strict()).min(1),
    diagnosticQuestions: z.array(z.object({
      id: idSchema,
      questionText: singleQuestionTextSchema,
      targetConcepts: z.array(idSchema).min(1).max(10),
      difficulty: z.number().int().min(1).max(5),
      equivalentGroup: idSchema,
      status: statusSchema,
    }).strict()).min(1),
    socraticQuestions: z.array(z.object({
      id: idSchema,
      questionType: z.enum(questionTypeValues),
      targetUnitId: idSchema,
      questionText: singleQuestionTextSchema,
      difficulty: z.number().int().min(1).max(5),
      triggerErrorTags: z.array(idSchema).max(10),
      triggerErrorCategories: z.array(idSchema).max(10).default([]),
      prerequisites: z.array(idSchema).max(10).default([]),
      status: statusSchema,
    }).strict()).min(1),
    questionGroups: z.array(z.object({
      id: idSchema,
      targetId: idSchema,
      memberIds: z.array(idSchema).min(1),
      selectionPolicy: z.literal("UNUSED_FIRST"),
    }).strict()).min(1),
    questionEdges: z.array(z.object({
      fromQuestionId: idSchema,
      conditionType: z.enum(["correct", "partial", "wrong", "unknown"]),
      conditionValue: z.string().min(1).max(120),
      toQuestionId: idSchema,
    }).strict()).max(50),
    hints: z.array(z.object({
      id: idSchema,
      questionId: idSchema,
      level: z.number().int().min(1).max(3),
      hintText: z.string().min(1).max(300),
    }).strict()).max(100),
    cases: z.array(z.object({
      id: idSchema,
      title: z.string().min(1).max(180),
      caseType: z.enum(["basic", "counterexample", "transfer", "comprehensive"]),
      difficulty: z.number().int().min(1).max(5),
      studentText: z.string().min(1).max(1200),
      variantGroupId: idSchema,
      originType: z.enum(["teacher_material", "internal_design", "web"]),
      sourceId: idSchema,
      targetUnits: z.array(idSchema).min(1).max(10),
      teacherData: z.object({
        followUpGroupIds: z.array(idSchema).min(1),
        expectedReasoning: z.string().min(1).max(600),
        commonErrors: z.array(z.string().min(1).max(300)).max(10),
        minimumAnswer: z.string().min(1).max(400),
        excellentAnswer: z.string().min(1).max(600),
      }).strict(),
      visibility: visibilitySchema,
      status: statusSchema,
    }).strict()).max(50),
    rubric: z.object({
      id: idSchema,
      version: versionSchema,
      status: statusSchema,
      dimensions: z.array(z.object({
        code: z.enum(["concept_completeness", "logic_completeness", "expression_clarity", "example_ability", "transfer_ability"]),
        title: z.string().min(1).max(80),
        maxScore: z.number().int().positive().max(100),
        weight: z.number().positive().max(10),
        anchors: z.array(z.object({
          scoreAnchor: z.number().int().min(0).max(100),
          description: z.string().min(1).max(300),
        }).strict()).min(3),
      }).strict()).length(5),
    }).strict(),
  })
  .strict();

export type KnowledgeManifest = z.infer<typeof knowledgeManifestSchema>;

export interface KnowledgeValidationResult {
  manifests: KnowledgeManifest[];
  errors: string[];
}

export function validateKnowledgeManifests(rawManifests: unknown[]): KnowledgeValidationResult {
  const manifests: KnowledgeManifest[] = [];
  const errors: string[] = [];
  rawManifests.forEach((raw, manifestIndex) => {
    const parsed = knowledgeManifestSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(...parsed.error.issues.map((issue) => `manifest[${manifestIndex}] ${issue.path.join(".")}: ${issue.message}`));
      return;
    }
    manifests.push(parsed.data);
  });

  const globalIds = new Set<string>();
  for (const manifest of manifests) {
    const localIds = new Set<string>();
    const register = (id: string, kind: string) => {
      if (localIds.has(id)) errors.push(`${manifest.knowledgePoint.code}: duplicate id ${id}`);
      localIds.add(id);
      const globalKey = `${manifest.release.id}:${kind}:${id}`;
      if (globalIds.has(globalKey)) errors.push(`duplicate global ${kind} id ${id}`);
      globalIds.add(globalKey);
    };

    manifest.sources.forEach((source) => register(source.id, "source"));
    manifest.knowledgeUnits.forEach((unit) => register(unit.id, "knowledgeUnit"));
    manifest.misconceptions.forEach((misconception) => register(misconception.id, "misconception"));
    manifest.diagnosticQuestions.forEach((question) => register(question.id, "diagnosticQuestion"));
    manifest.socraticQuestions.forEach((question) => register(question.id, "socraticQuestion"));
    manifest.questionGroups.forEach((group) => register(group.id, "questionGroup"));
    manifest.hints.forEach((hint) => register(hint.id, "hint"));
    manifest.cases.forEach((item) => register(item.id, "case"));

    const unitIds = new Set(manifest.knowledgeUnits.map((unit) => unit.id));
    const targetIds = new Set([...unitIds, ...(manifest.v12?.competencies.map((item) => item.id) ?? [])]);
    const sourceIds = new Set(manifest.sources.map((source) => source.id));
    const misconceptionIds = new Set(manifest.misconceptions.map((item) => item.id));
    const questionIds = new Set(manifest.socraticQuestions.map((question) => question.id));
    const groupIds = new Set(manifest.questionGroups.map((group) => group.id));
    const memberships = new Map<string, number>();
    if (manifest.v12) {
      const v = manifest.v12;
      if (manifest.release.id !== "KR_SR_1_2" || manifest.knowledgePoint.version !== "1.2") errors.push("v1.2 release/version mismatch");
      for (const id of ["SQG_SR_006A", "SQG_SR_006B", "SQG_SR_010"]) if (!groupIds.has(id)) errors.push(`Missing required group ${id}`);
      if (groupIds.has("SQG_SR_006")) errors.push("Legacy 006 group must be archived outside v1.2");
      const relationIds = new Set(v.relations.map((r) => r.id));
      if (relationIds.size !== 8 || v.relations.length !== 8) errors.push("Expected eight unique relations");
      for (const r of v.relations) if (!unitIds.has(r.source) || !unitIds.has(r.target)) errors.push(`${r.id}: invalid relation target`);
      const checkRule = (id: string, rule: import("./v12-schema").EvidenceRule) => {
        for (const e of [...rule.requiredAll, ...rule.requiredAny, ...rule.prohibited]) if (!v.evidenceDefinitions[e]) errors.push(`${id}: unknown evidence ${e}`);
      };
      if (v.coachingPolicy) {
        const policy = v.coachingPolicy;
        for (const route of policy.routingRules) register(route.id, "coachingRoute");
        for (const rule of policy.confidenceRouting?.rules ?? []) {
          register(rule.id, "coachingConfidence");
          checkRule(rule.id, { requiredAll: rule.requiredAll, requiredAny: [], prohibited: rule.absentAll });
          if (!v.unitRules[rule.targetId] || !v.unitRules[rule.gapTargetId] || v.gaps[rule.gapId] !== rule.gapTargetId) errors.push(`${rule.id}: gap must belong to its declared target`);
          if (new Set([...rule.requiredAll, ...rule.absentAll]).size !== rule.requiredAll.length + rule.absentAll.length) errors.push(`${rule.id}: evidence conditions must be unique and disjoint`);
          const targetRule = v.unitRules[rule.targetId];
          if (targetRule && rule.requiredAll.some((id) => targetRule.prohibited.includes(id))) errors.push(`${rule.id}: supporting evidence cannot be prohibited`);
          const requirements = (id: string) => [...(v.unitRules[id]?.requiredAll ?? []), ...(v.unitRules[id]?.requiredAny ?? [])];
          if (!rule.requiredAll.some((id) => requirements(rule.targetId).includes(id)) || !rule.absentAll.some((id) => requirements(rule.targetId).includes(id)) || !rule.absentAll.some((id) => requirements(rule.gapTargetId).includes(id))) errors.push(`${rule.id}: coaching target and gap must share relevant evidence requirements`);
          for (const id of rule.absentAll) if (!Object.values(policy.dimensions).some((dimension) => dimension.evidenceIds.includes(id))) errors.push(`${rule.id}: missing evidence lacks a coaching dimension: ${id}`);
        }
        if (new Set(policy.dimensionPriority).size !== 5) errors.push("Coaching dimension priorities must be unique");
        for (const [dimension, config] of Object.entries(policy.dimensions)) {
          checkRule(dimension, { requiredAll: config.evidenceIds, requiredAny: [], prohibited: [] });
          for (const level of ["L1", "L2", "L3", "L4"] as const) if (!policy.forms.some((f) => f.dimension === dimension && f.levels.includes(level))) errors.push(`${dimension}: missing coaching form for ${level}`);
        }
        for (const form of policy.forms) {
          register(form.id, "coachingForm");
          if (!form.template.includes("{target}") || (form.template.match(/[?？]/gu) ?? []).length !== 1 || /\{(?!target\})/u.test(form.template)) errors.push(`${form.id}: invalid coaching question template`);
        }
        for (const frames of Object.values(policy.stageFrames)) for (const frame of frames) {
          register(frame.id, "coachingFrame");
          if (frame.template.split("{content}").length !== 2 || /\{(?!content\})/u.test(frame.template)) errors.push(`${frame.id}: must preserve exactly one locked content slot`);
        }
        for (const [dimension, tiers] of Object.entries(policy.scoreCriteria)) for (const tier of tiers) checkRule(dimension, { requiredAll: tier, requiredAny: [], prohibited: [] });
        for (const rule of policy.verificationRules ?? []) {
          register(rule.id, "coachingVerification");
          checkRule(rule.id, { requiredAll: rule.requiredAll, requiredAny: [], prohibited: [] });
          if (new Set(rule.requiredAll).size !== rule.requiredAll.length || new Set(rule.targetIds).size !== rule.targetIds.length) errors.push(`${rule.id}: verification requirements and targets must be unique`);
          for (const targetId of rule.targetIds) {
            if (!v.unitRules[targetId]) errors.push(`${rule.id}: unknown verification target ${targetId}`);
            if (rule.requiredAll.some((id) => v.unitRules[targetId]?.prohibited.includes(id))) errors.push(`${rule.id}: verification requires prohibited evidence`);
          }
          for (const id of rule.requiredAll) if (!Object.values(policy.dimensions).some((dimension) => dimension.evidenceIds.includes(id))) errors.push(`${rule.id}: verification evidence lacks a coaching dimension: ${id}`);
        }
      }
      for (const [id, rule] of Object.entries(v.unitRules)) { if (!targetIds.has(id)) errors.push(`${id}: unknown mastery target`); checkRule(id, rule); }
      for (const [id, rule] of Object.entries(v.relationRules)) { if (!relationIds.has(id)) errors.push(`${id}: unknown relation rule`); checkRule(id, rule); }
      if (v.pedagogyRules.length !== 18 || new Set(v.pedagogyRules.map((r) => r.id)).size !== 18) errors.push("Expected eighteen unique pedagogy rules");
      for (const r of v.pedagogyRules) if (r.priorityLabel !== ({ 100: "medium", 200: "high", 300: "critical" } as const)[r.priority]) errors.push(`${r.id}: priority label mismatch`);
      for (const unit of manifest.knowledgeUnits) {
        if (!v.unitRules[unit.id]) errors.push(`${unit.id}: missing mastery rule`);
        const refs = v.unitSourceRefs[unit.id];
        if (!refs || [...refs.contentSourceRefs, ...refs.teachingSourceRefs, ...refs.assessmentSourceRefs].some((id) => !sourceIds.has(id))) errors.push(`${unit.id}: invalid source mapping`);
      }
      for (const q of manifest.diagnosticQuestions) { const r = v.diagnosticRules[q.equivalentGroup]; if (!r) errors.push(`${q.id}: missing diagnostic rule`); else checkRule(q.id, r); }
      for (const g of manifest.questionGroups) {
        const config = v.groups[g.id];
        if (!config || config.primaryTargetId !== g.targetId) { errors.push(`${g.id}: invalid group definition`); continue; }
        checkRule(g.id, config.rule);
        for (const p of [...config.prerequisites, ...config.secondaryTargets]) if (!targetIds.has(p)) errors.push(`${g.id}: unknown prerequisite/secondary target ${p}`);
        for (const id of config.triggerErrors) if (!v.errors[id]) errors.push(`${g.id}: invalid error ${id}`);
        for (const id of config.triggerGaps) if (!v.gaps[id]) errors.push(`${g.id}: invalid gap ${id}`);
      }
      for (const edge of v.edges) {
        if (edge.from !== "ANY_GROUP" && !groupIds.has(edge.from)) errors.push(`Invalid edge source ${edge.from}`);
        if (!groupIds.has(edge.to) && !["HINT_LEVEL_1", "HINT_LEVEL_2", "NEED_VERIFY"].includes(edge.to)) errors.push(`Invalid edge target ${edge.to}`);
      }
      for (const c of manifest.cases) {
        const config = v.cases[c.id];
        if (!config) { errors.push(`${c.id}: missing case rules`); continue; }
        checkRule(c.id, config.rule);
        for (const step of config.criticalSteps) {
          if (!targetIds.has(step) && !relationIds.has(step)) errors.push(`${c.id}: invalid critical step ${step}`);
          if (!(v.unitRules[step] ?? v.relationRules[step])) errors.push(`${c.id}: missing executable rule for ${step}`);
          if (!groupIds.has(config.followUp[step])) errors.push(`${c.id}: missing follow-up for ${step}`);
        }
      }
      for (const id of misconceptionIds) if (!v.errors[id]) errors.push(`${id}: legacy or unknown error in v1.2`);
      for (const [id, e] of Object.entries(v.errors)) { if (!unitIds.has(e.targetId) || !v.evidenceDefinitions[e.evidenceId]) errors.push(`${id}: invalid error definition`); checkRule(id, e.resolutionRule); }
      for (const [id, target] of Object.entries(v.gaps)) if (!targetIds.has(target)) errors.push(`${id}: invalid gap target`);
      for (const source of manifest.sources.filter((s) => s.id.startsWith("DOC_SR_"))) if (source.checksum !== v.sourceDocumentHashes[source.id]) errors.push(`${source.id}: source hash mismatch`);
    }
    for (const group of manifest.questionGroups) {
      if (!targetIds.has(group.targetId)) errors.push(`${group.id}: missing target unit`);
      for (const id of group.memberIds) {
        const question = manifest.socraticQuestions.find((item) => item.id === id);
        if (!question || question.targetUnitId !== group.targetId) errors.push(`${group.id}: invalid member ${id}`);
        memberships.set(id, (memberships.get(id) ?? 0) + 1);
      }
    }
    for (const id of questionIds) {
      if (memberships.get(id) !== 1) errors.push(`${id}: must belong to exactly one group`);
    }
    for (const question of manifest.diagnosticQuestions) {
      for (const target of question.targetConcepts) {
        if (!unitIds.has(target)) errors.push(`${question.id}: missing diagnostic target ${target}`);
      }
    }
    if (new Set(manifest.rubric.dimensions.map((item) => item.code)).size !== 5) errors.push("Rubric dimensions must be unique");
    for (const dimension of manifest.rubric.dimensions) {
      if (dimension.maxScore !== 20 || dimension.anchors.map((item) => item.scoreAnchor).join(",") !== "0,5,10,15,20") {
        errors.push(`${dimension.code}: expected five anchors 0,5,10,15,20`);
      }
    }
    if (manifest.release.status === "published") {
      if (!manifest.release.verifiedBy || !manifest.release.verifiedAt) errors.push("Published release requires reviewer and review time");
      const resources = [manifest.course, manifest.chapter, manifest.knowledgePoint, manifest.rubric, ...manifest.knowledgeUnits, ...manifest.misconceptions, ...manifest.diagnosticQuestions, ...manifest.socraticQuestions, ...manifest.cases];
      if (resources.some((item) => item.status !== "published")) errors.push("Published release contains unpublished resources");
      if (manifest.sources.some((item) => !["reviewed", "published"].includes(item.status) || !/^[a-f0-9]{64}$/u.test(item.checksum))) errors.push("Published sources require review and SHA-256 checksums");
    }

    for (const unit of manifest.knowledgeUnits) {
      for (const target of [...unit.prerequisites, ...unit.relations.map((relation) => relation.target)]) {
        if (!unitIds.has(target)) errors.push(`${unit.id}: missing related knowledge unit ${target}`);
      }
      for (const sourceRef of unit.sourceRefs) {
        if (!sourceIds.has(sourceRef.sourceId)) errors.push(`${unit.id}: missing source ${sourceRef.sourceId}`);
      }
      for (const misconception of unit.misconceptions) {
        if (!misconceptionIds.has(misconception)) errors.push(`${unit.id}: missing misconception ${misconception}`);
      }
    }

    for (const misconception of manifest.misconceptions) {
      for (const target of misconception.targetUnits) {
        if (!unitIds.has(target)) errors.push(`${misconception.id}: missing target unit ${target}`);
      }
    }
    for (const question of manifest.socraticQuestions) {
      if (!targetIds.has(question.targetUnitId)) errors.push(`${question.id}: missing target unit ${question.targetUnitId}`);
      for (const prerequisite of question.prerequisites) {
        if (!unitIds.has(prerequisite)) errors.push(`${question.id}: missing prerequisite unit ${prerequisite}`);
      }
      for (const tag of question.triggerErrorTags) {
        if (!misconceptionIds.has(tag)) errors.push(`${question.id}: trigger must use stable error ID ${tag}`);
      }
      for (const category of question.triggerErrorCategories) {
        if (!manifest.misconceptions.some((item) => item.category === category)) errors.push(`${question.id}: missing error category ${category}`);
      }
    }
    for (const edge of manifest.questionEdges) {
      if (!questionIds.has(edge.fromQuestionId)) errors.push(`${edge.fromQuestionId}: missing edge source question`);
      if (!questionIds.has(edge.toQuestionId)) errors.push(`${edge.fromQuestionId}: missing edge target question ${edge.toQuestionId}`);
    }
    for (const hint of manifest.hints) {
      if (!questionIds.has(hint.questionId)) errors.push(`${hint.id}: missing question ${hint.questionId}`);
    }
    for (const item of manifest.cases) {
      for (const groupId of item.teacherData.followUpGroupIds) {
        if (!groupIds.has(groupId)) errors.push(`${item.id}: missing follow-up group ${groupId}`);
      }
      if (!sourceIds.has(item.sourceId)) errors.push(`${item.id}: missing source ${item.sourceId}`);
      for (const target of item.targetUnits) {
        if (!unitIds.has(target)) errors.push(`${item.id}: missing target unit ${target}`);
      }
    }
  }

  return { manifests, errors };
}
