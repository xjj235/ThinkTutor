export const diagnosticQuestionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["question", "questionType"],
  properties: {
    question: { type: "string" },
    questionType: {
      type: "string",
      enum: ["CONCEPT_CLARIFICATION"],
    },
  },
};

export const coachTurnJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["question", "questionType", "suggestion"],
  properties: {
    question: { type: "string" },
    questionType: {
      type: "string",
      enum: [
        "CONCEPT_CLARIFICATION",
        "CAUSE_PROBE",
        "ASSUMPTION_TEST",
        "COUNTEREXAMPLE",
        "TRANSFER",
        "SCAFFOLDED_HINT",
      ],
    },
    suggestion: {
      type: "string",
      enum: ["CONTINUE", "REQUEST_FEYNMAN"],
    },
  },
};

const dimensionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "evidence", "feedback"],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    evidence: { type: "string" },
    feedback: { type: "string" },
  },
};

export const learningReportJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "dimensions", "mastered", "gaps", "nextSteps"],
  properties: {
    summary: { type: "string" },
    dimensions: {
      type: "object",
      additionalProperties: false,
      required: [
        "conceptCompleteness",
        "logicCompleteness",
        "expressionClarity",
        "exampleAbility",
        "transferAbility",
      ],
      properties: {
        conceptCompleteness: dimensionSchema,
        logicCompleteness: dimensionSchema,
        expressionClarity: dimensionSchema,
        exampleAbility: dimensionSchema,
        transferAbility: dimensionSchema,
      },
    },
    mastered: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    gaps: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 8,
    },
    nextSteps: {
      type: "array",
      items: { type: "string" },
      maxItems: 3,
    },
  },
};
