import "dotenv/config";

import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "../src/lib/auth/password";

const databaseUrl = z.string().startsWith("postgresql://").parse(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdin.setRawMode) throw new Error("管理员创建必须在交互式终端中运行。");
  stdout.write(prompt);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  let value = "";
  return new Promise((resolve, reject) => {
    const onKey = (input: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("已取消。"));
      } else if (key.name === "return") {
        cleanup();
        stdout.write("\n");
        resolve(value);
      } else if (key.name === "backspace") {
        value = value.slice(0, -1);
      } else if (input && !key.ctrl) {
        value += input;
      }
    };
    const cleanup = () => {
      stdin.off("keypress", onKey);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on("keypress", onKey);
  });
}

async function main(): Promise<void> {
  const readline = createInterface({ input: stdin, output: stdout });
  const email = z.string().trim().toLowerCase().email().max(254).parse(await readline.question("管理员邮箱："));
  const name = z.string().trim().min(2).max(60).parse(await readline.question("管理员姓名："));
  readline.close();
  const password = z.string().min(12).max(128).regex(/[a-zA-Z]/).regex(/[0-9]/).parse(await readHidden("管理员密码（不回显）："));
  if (await prisma.user.findUnique({ where: { email } })) throw new Error("该邮箱已经存在，拒绝覆盖。");
  const admin = await prisma.user.create({ data: { email, name, passwordHash: await hashPassword(password), role: "ADMIN" }, select: { id: true, email: true } });
  process.stdout.write(`已创建管理员 ${admin.email}（${admin.id}）。\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Admin creation failed"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
