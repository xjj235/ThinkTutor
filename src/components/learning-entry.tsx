import Link from "next/link";
import { Plus } from "lucide-react";

export function LearningEntry({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="learning-home-entry" aria-labelledby="home-title">
      <div className="learning-entry-copy">
        <h1 id="home-title">{signedIn ? "今天，想弄懂什么？" : "问思学伴"}</h1>
        <p>从一个想弄懂的知识点开始。</p>
        <Link className="button learning-entry-action" href={signedIn ? "/learn/new" : "/login?next=%2Flearn%2Fnew"}>
          <Plus size={20} aria-hidden="true" />新建学习任务
        </Link>
      </div>
    </section>
  );
}
