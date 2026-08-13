import {
  LearningPhase,
  phaseLabels,
} from "@/lib/contracts";

const phases: LearningPhase[] = [
  "DIAGNOSIS",
  "SOCRATIC",
  "FEYNMAN",
  "COMPLETED",
];

export function PhaseProgress({
  phase,
  socraticTurns,
  maxTurns,
}: {
  phase: LearningPhase;
  socraticTurns: number;
  maxTurns: number;
}) {
  const activeIndex = phase === "REPORTING" || phase === "COMPLETED" ? 3 : phases.indexOf(phase);

  return (
    <section aria-label="学习阶段" className="phase-progress space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#213236]">当前阶段</h2>
        <span className="rounded-full border border-[#b9d8d4] bg-[#eef8f6] px-3 py-1 text-sm font-medium text-[#115e59]">
          {phaseLabels[phase]}
        </span>
      </div>
      <ol className="grid grid-cols-2 gap-2">
        {phases.map((item, index) => {
          const completed = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li
              key={item}
              className={[
                "rounded-md border px-3 py-2 text-sm",
                active
                  ? "border-[#0f766e] bg-[#eef8f6] text-[#0f3f3b]"
                  : completed
                    ? "border-[#b9d8d4] bg-white text-[#2f5f5a]"
                    : "border-[#dce7e6] bg-white text-[#68787c]",
              ].join(" ")}
              aria-current={active ? "step" : undefined}
            >
              <span className="block text-xs">
                {completed ? "已完成" : active ? "进行中" : "待开始"}
              </span>
              <span className="font-medium">{phaseLabels[item]}</span>
            </li>
          );
        })}
      </ol>
      <div className="text-sm text-[#5d6b70]">
        苏格拉底追问进度：{Math.min(socraticTurns, maxTurns)} / {maxTurns}
      </div>
    </section>
  );
}
