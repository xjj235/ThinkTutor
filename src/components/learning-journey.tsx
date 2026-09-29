import type { LearningReportDTO, MessageDTO } from "@/lib/contracts";
import { learningJourneySteps } from "@/lib/learning-journey";
import { SafeMarkdown } from "./safe-markdown";

export function LearningJourney({ messages, sessionId, inReport = false, report }: { messages: MessageDTO[]; sessionId: string; inReport?: boolean; report?: LearningReportDTO | null }) {
  const steps = learningJourneySteps(messages, sessionId, report);
  if (!steps.length) return null;
  return (
    <section className="learning-journey" aria-labelledby="learning-journey-title">
      <h2 id="learning-journey-title">我的理解如何变化</h2>
      <p className="text-muted-foreground">回看原来的表达、追问的原因和后来的补充。是否补齐，以后续反馈和报告为依据。</p>
      <ol>
        {steps.map((entry, index) => {
          const { step } = entry;
          const recordId = entry.kind === "feedback" ? entry.step.answer.id : step.response?.id ?? step.question.id;
          return <li key={step.question.id} data-testid={entry.kind === "feynman" ? "independent-explanation-step" : undefined}>
            <details>
              <summary><span>第 {index + 1} 步</span><strong>{entry.kind === "feedback" ? entry.step.feedback.focus : "费曼阶段任务"}</strong></summary>
              <div className="journey-step">
                <dl>
                  {entry.kind === "feedback" ? <>
                    <div><dt>我原来的表达</dt><dd><blockquote>“{entry.step.feedback.answerQuote}”</blockquote><p>{entry.step.feedback.observation}</p></dd></div>
                    <div><dt>为什么继续想</dt><dd>{entry.step.feedback.whyItMatters}</dd></div>
                  </> : null}
                  <div><dt>当时的追问或任务</dt><dd><SafeMarkdown>{step.question.content}</SafeMarkdown></dd></div>
                  <div><dt>{entry.kind === "feynman" ? "我的作答" : "我后来的补充"}</dt><dd>{step.response ? <blockquote>{step.response.content.length > 320 ? `${step.response.content.slice(0, 320)}…` : step.response.content}</blockquote> : <p>{step.responseStatus === "replaced" ? "后续切换了学习任务，这条追问没有对应的后续作答。" : "还没有新的作答记录。"}</p>}</dd></div>
                  <div><dt>后续反馈</dt><dd>{step.review ? <><p>{step.review.progress ?? step.review.observation}</p><p className="text-muted-foreground">仍需关注：{step.review.focus}</p></> : <p>{step.response ? "本条后续作答没有单独的逐轮反馈，请结合学习报告核对。" : step.responseStatus === "replaced" ? "后续任务的作答未计入这条追问，不能据此判断原缺口已补齐。" : "作答后再核对理解的变化。"}</p>}</dd></div>
                </dl>
                {entry.report ? <JourneyReportFeedback report={entry.report} /> : null}
                <a className="text-link" href={inReport ? `/session/${sessionId}#message-${recordId}` : `#message-${recordId}`} onClick={inReport ? undefined : () => {
                  const history = document.getElementById("learning-history");
                  if (history instanceof HTMLDetailsElement) history.open = true;
                }}>查看完整作答记录</a>
              </div>
            </details>
          </li>;
        })}
      </ol>
    </section>
  );
}

function JourneyReportFeedback({ report }: { report: LearningReportDTO }) {
  const openGaps = report.gaps.filter((gap) => gap.status === "OPEN" || gap.status === "IN_PROGRESS");
  return <div className="journey-report-feedback" data-testid="journey-report-feedback">
    <h3>整次学习报告</h3>
    <p className="text-muted-foreground">报告综合整次学习对话，不单独判定这次作答，也不表示所有缺口都已补齐。</p>
    <SafeMarkdown>{report.summary}</SafeMarkdown>
    {openGaps.length ? <><h4>报告中仍需巩固</h4><ul>{openGaps.map((gap, index) => <li key={`${gap.title}-${index}`}><strong>{gap.title}</strong><p>{gap.evidence}</p></li>)}</ul></> : null}
  </div>;
}
