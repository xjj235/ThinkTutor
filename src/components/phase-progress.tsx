"use client";

import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { LearningPhase, phaseLabels, type LearningSessionDTO } from "@/lib/contracts";

const phases: LearningPhase[] = ["DIAGNOSIS", "SOCRATIC", "FEYNMAN", "COMPLETED"];
const knowledgeStages = ["GOAL_PRESENTATION", "DIAGNOSIS", "KNOWLEDGE_CONSTRUCTION", "CASE_TRANSFER", "FEYNMAN_OUTPUT", "REFLECTION", "REPORT"];
const knowledgeLabels = ["学习目标", "认知诊断", "知识建构", "迁移验证", "费曼阐释", "反思修订", "学习报告"];

export function PhaseProgress({ phase, socraticTurns, maxTurns, knowledgeProgress }: {
  phase: LearningPhase;
  socraticTurns: number;
  maxTurns: number;
  knowledgeProgress?: LearningSessionDTO["knowledgeProgress"];
}) {
  const stageList = useRef<HTMLOListElement>(null);
  const stages = knowledgeProgress ? knowledgeStages : phases;
  const labels = knowledgeProgress ? knowledgeLabels : phases.map((item) => phaseLabels[item]);
  const activeIndex = knowledgeProgress
    ? knowledgeStages.indexOf(knowledgeProgress.pedagogicalStage)
    : phase === "REPORTING" || phase === "COMPLETED" ? 3 : phases.indexOf(phase);

  useEffect(() => {
    const list = stageList.current;
    if (!list) return;
    const revealCurrentStage = () => {
      const current = list.querySelector<HTMLElement>('[aria-current="step"]');
      if (current) list.scrollLeft = Math.max(0, current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2);
    };
    revealCurrentStage();
    const observer = new ResizeObserver(revealCurrentStage);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeIndex]);

  return <section aria-label="学习阶段" className="phase-progress">
    <div className="phase-heading"><h2>学习阶段</h2><p>苏格拉底追问 <strong>{Math.min(socraticTurns, maxTurns)}</strong> / {maxTurns}</p></div>
    <ol ref={stageList} tabIndex={0} aria-label="研习阶段进度">
      {stages.map((stage, index) => <li key={stage} data-state={index < activeIndex ? "past" : index === activeIndex ? "active" : "upcoming"} aria-current={index === activeIndex ? "step" : undefined}>
        <span className="phase-marker" aria-hidden="true">{index < activeIndex ? <Check size={14} /> : index + 1}</span>
        <span className="phase-label">{labels[index]}<small>{index < activeIndex ? "已历经" : index === activeIndex ? "当前阶段" : "待进入"}</small></span>
      </li>)}
    </ol>
    {knowledgeProgress?.experienceLimitReached ? <p className="phase-notice">本次研习已达轮次上限，待验证内容已保留。</p> : null}
  </section>;
}
