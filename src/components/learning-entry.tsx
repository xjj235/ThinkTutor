import Link from "next/link";
import { Plus } from "lucide-react";
import styles from "./learning-entry.module.css";

const learningSteps = [
  { title: "选一个想弄懂的知识点", description: "写下主题和学习目标，先用自己的话说说当前的理解。" },
  { title: "跟着追问，把思路理清", description: "根据你的回答展开 3–5 轮追问，也说明为什么要想这一步。" },
  { title: "用自己的话，独立讲一遍", description: "像讲给第一次接触的同学听，解释概念、原因和例子。" },
  { title: "查看反馈，再练关键要点", description: "回看作答依据和待补充的地方，从优先要点继续巩固。" },
];

export function LearningEntry({ signedIn }: { signedIn: boolean }) {
  return (
    <section className={styles.overview} aria-labelledby="home-title">
      <div className={styles.introduction}>
        <h1 id="home-title">{signedIn ? "今天，想把哪个知识点讲清楚？" : "用追问理清思路，用讲解检验理解"}</h1>
        <p className={styles.purpose}>问思学伴，你的 <strong>AI 自主学习教练</strong>。</p>
        <p className={styles.description}>带着课堂里学过的知识，通过连续追问发现理解中的空缺，再用自己的话讲清楚，得到有作答依据的学习反馈。</p>
        <Link className={`button ${styles.action}`} href={signedIn ? "/learn/new" : "/login?next=%2Flearn%2Fnew"}>
          <Plus size={20} aria-hidden="true" />新建学习任务
        </Link>
        <p className={styles.startHint}>{signedIn ? "从一个主题和学习目标开始。历史记录与课程任务在右上角个人中心。" : "选择一个知识点就能开始；登录后继续创建任务。"}</p>
      </div>

      <div className={styles.guide}>
        <section className={styles.workflow} aria-labelledby="home-workflow-title">
          <h2 id="home-workflow-title">一次学习，怎么进行</h2>
          <p className={styles.sectionDescription}>你负责思考与表达，AI 负责追问与反馈。</p>
          <ol className={styles.steps}>
            {learningSteps.map((step, index) => <li key={step.title}>
              <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
              <div><h3>{step.title}</h3><p>{step.description}</p></div>
            </li>)}
          </ol>
        </section>

        <section className={styles.example} aria-labelledby="home-example-title">
          <header className={styles.exampleHeader}>
            <h2 id="home-example-title">追问怎样帮助你思考</h2>
            <p>演示对话 · 非实际学习记录</p>
          </header>
          <dl className={styles.dialogue}>
            <div className={styles.studentLine}><dt>你的初步理解</dt><dd>“我觉得任何三角形都能用勾股定理。”</dd></div>
            <div><dt>教练先说明关注点</dt><dd>你把适用范围放到了所有三角形。我们用一组具体边长检查这个判断。</dd></div>
            <div className={styles.questionLine}><dt>再提出一个具体问题</dt><dd>三角形的三边为 3、4、6，把它们代入你熟悉的关系，等式成立吗？</dd></div>
          </dl>
          <p className={styles.exampleNote}>从你的回答出发，解释追问目的，把判断和表达留给你。</p>
        </section>
      </div>

      <section className={styles.outcomes} aria-labelledby="home-outcomes-title">
        <h2 id="home-outcomes-title">完成后，留下自己的学习成果</h2>
        <dl>
          <div><dt>一段自己的讲解</dt><dd>用独立表达检验概念、原因和例子是否讲清。</dd></div>
          <div><dt>一份有依据的反馈</dt><dd>结合本次作答查看五个维度的表现与证据限制。</dd></div>
          <div><dt>一个明确的下一步</dt><dd>围绕优先要点再练，继续补充和核验理解。</dd></div>
        </dl>
      </section>
    </section>
  );
}
