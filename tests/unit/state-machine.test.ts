import { describe, expect, it } from "vitest";
import {
  computeUnknownStreak,
  isLowInformationAnswer,
  nextAfterDiagnosisAnswer,
  nextAfterSocraticAnswer,
} from "@/lib/state-machine";

describe("state machine", () => {
  it("moves from diagnosis to socratic after a diagnosis answer", () => {
    expect(nextAfterDiagnosisAnswer()).toEqual({
      phase: "SOCRATIC",
      socraticRound: 0,
      forceFeynman: false,
    });
  });

  it("does not enter Feynman before three Socratic rounds", () => {
    const transition = nextAfterSocraticAnswer(
      { phase: "SOCRATIC", socraticRound: 1, unknownStreak: 0 },
      "REQUEST_FEYNMAN",
    );

    expect(transition.phase).toBe("SOCRATIC");
    expect(transition.socraticRound).toBe(2);
  });

  it("accepts REQUEST_FEYNMAN after the minimum round count", () => {
    const transition = nextAfterSocraticAnswer(
      { phase: "SOCRATIC", socraticRound: 2, unknownStreak: 0 },
      "REQUEST_FEYNMAN",
    );

    expect(transition.phase).toBe("FEYNMAN");
    expect(transition.socraticRound).toBe(3);
  });

  it("forces Feynman at the maximum round count", () => {
    const transition = nextAfterSocraticAnswer(
      { phase: "SOCRATIC", socraticRound: 4, unknownStreak: 0 },
      "CONTINUE",
    );

    expect(transition.phase).toBe("FEYNMAN");
    expect(transition.socraticRound).toBe(5);
    expect(transition.forceFeynman).toBe(true);
  });

  it("detects repeated unknown answers deterministically", () => {
    expect(isLowInformationAnswer("不知道")).toBe(true);
    expect(computeUnknownStreak("不知道", 2)).toBe(3);
    expect(computeUnknownStreak("我认为它和条件变化有关", 2)).toBe(0);
  });
});
