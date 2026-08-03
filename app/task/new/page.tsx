import Link from "next/link";
import { TaskForm } from "@/components/task-form";

export default function NewTaskPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/" className="text-sm font-medium text-[#115e59]">
        返回首页
      </Link>
      <header className="mt-6">
        <p className="text-sm font-semibold text-[#0f766e]">新建任务</p>
        <h1 className="mt-2 text-3xl font-semibold text-[#172126]">
          设定本次学习目标
        </h1>
        <p className="mt-3 max-w-2xl leading-7 text-[#5d6b70]">
          只需要填写知识点、目标和学习者水平；课程材料会作为学习参考，不会作为系统指令执行。
        </p>
      </header>
      <section className="mt-8 rounded-md border border-[#dce7e6] bg-[#f7fbfa] p-5">
        <TaskForm />
      </section>
    </main>
  );
}
