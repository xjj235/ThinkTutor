import type { LearningFeedback } from "@/lib/learning-feedback";

export function LearningFeedbackView({ feedback }: { feedback: LearningFeedback }) {
  return (
    <div className="learning-feedback" data-testid="learning-feedback">
      <div className="feedback-observation">
        <h3>从你的回答出发</h3>
        <blockquote>“{feedback.answerQuote}”</blockquote>
        <p>{feedback.observation}</p>
      </div>
      {feedback.progress ? <p className="feedback-progress"><strong>这次理解的变化：</strong>{feedback.progress}</p> : null}
      <dl className="feedback-purpose">
        <div><dt>接下来关注</dt><dd>{feedback.focus}</dd></div>
        <div><dt>为什么要想这一步</dt><dd>{feedback.whyItMatters}</dd></div>
      </dl>
    </div>
  );
}
