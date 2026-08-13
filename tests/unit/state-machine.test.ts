import { describe, expect, it } from "vitest";
import {
  canEnterFeynmanVoluntarily,
  computeUnknownStreak,
  enterFeynmanVoluntarily,
  isLowInformationAnswer,
  nextAfterDiagnosisAnswer,
  nextAfterFeynman,
  nextAfterReportSaved,
  nextAfterSocraticAnswer,
} from "@/lib/state-machine";

describe("state machine", () => {
  it("moves from diagnosis to socratic after a diagnosis answer", () => {
    expect(
      nextAfterDiagnosisAnswer({
        phase: "DIAGNOSIS",
        socraticTurns: 0,
        maxTurns: 5,
      }),
    ).toEqual({
      phase: "SOCRATIC",
      socraticTurns: 0,
      forceFeynman: false,
    });
  });

  it("does not enter Feynman before three Socratic rounds", () => {
    const transition = nextAfterSocraticAnswer(
      { phase: "SOCRATIC", socraticTurns: 1, maxTurns: 5 },
      "REQUEST_FEYNMAN",
    );

    expect(transition.phase).toBe("SOCRATIC");
    expect(transition.socraticTurns).toBe(2);
  });

  it("accepts REQUEST_FEYNMAN after the minimum round count", () => {
    const transition = nextAfterSocraticAnswer(
      { phase: "SOCRATIC", socraticTurns: 2, maxTurns: 5 },
      "REQUEST_FEYNMAN",
    );

    expect(transition.phase).toBe("FEYNMAN");
    expect(transition.socraticTurns).toBe(3);
  });

  it("forces Feynman at the maximum round count", () => {
    const transition = nextAfterSocraticAnswer(
      { phase: "SOCRATIC", socraticTurns: 4, maxTurns: 5 },
      "ASK_QUESTION",
    );

    expect(transition.phase).toBe("FEYNMAN");
    expect(transition.socraticTurns).toBe(5);
    expect(transition.forceFeynman).toBe(true);
  });

  it("allows the learner to enter Feynman after three completed rounds", () => {
    const session = {
      phase: "SOCRATIC" as const,
      socraticTurns: 3,
      maxTurns: 5,
    };

    expect(canEnterFeynmanVoluntarily(session)).toBe(true);
    expect(enterFeynmanVoluntarily(session)).toEqual({
      phase: "FEYNMAN",
      socraticTurns: 3,
      forceFeynman: false,
    });
    expect(
      canEnterFeynmanVoluntarily({ ...session, socraticTurns: 2 }),
    ).toBe(false);
    expect(() =>
      enterFeynmanVoluntarily({ ...session, socraticTurns: 2 }),
    ).toThrow("sufficient Socratic evidence");
  });

  it("detects repeated unknown answers deterministically", () => {
    expect(isLowInformationAnswer("不知道")).toBe(true);
    expect(computeUnknownStreak("不知道", 2)).toBe(3);
    expect(computeUnknownStreak("我认为它和条件变化有关", 2)).toBe(0);
  });

  it("rejects transitions from the wrong source phase", () => {
    expect(() =>
      nextAfterDiagnosisAnswer({
        phase: "SOCRATIC",
        socraticTurns: 0,
        maxTurns: 5,
      }),
    ).toThrow("DIAGNOSIS");

    expect(() =>
      nextAfterSocraticAnswer(
        { phase: "FEYNMAN", socraticTurns: 3, maxTurns: 5 },
        "ASK_QUESTION",
      ),
    ).toThrow("SOCRATIC");
  });

  it("uses REPORTING while a report is generated, then completes without changing turns", () => {
    const reporting = nextAfterFeynman({
        phase: "FEYNMAN",
        socraticTurns: 3,
        maxTurns: 5,
      });
    expect(reporting).toEqual({
      phase: "REPORTING",
      socraticTurns: 3,
      forceFeynman: false,
    });
    expect(nextAfterReportSaved({ ...reporting, maxTurns: 5 })).toEqual({ phase: "COMPLETED", socraticTurns: 3, forceFeynman: false });
  });

  it("rejects invalid counters", () => {
    expect(() =>
      nextAfterSocraticAnswer(
        { phase: "SOCRATIC", socraticTurns: -1, maxTurns: 5 },
        "ASK_QUESTION",
      ),
    ).toThrow("non-negative integer");
  });
});
