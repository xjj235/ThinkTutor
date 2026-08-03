import "dotenv/config";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaLibSql({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  }),
});

async function main() {
  const existing = await prisma.learningSession.findFirst({
    where: {
      topic: "系统性风险",
    },
  });

  if (existing) {
    return;
  }

  await prisma.learningSession.create({
    data: {
      course: "金融学导论",
      chapter: "风险与金融稳定",
      topic: "系统性风险",
      goal: "理解系统性风险如何从局部冲击扩散到整体金融系统。",
      learnerLevel: "有基础",
      referenceText:
        "系统性风险是指单个机构、市场或基础设施受到冲击后，通过关联、信心、流动性和杠杆等渠道扩散，影响整个金融体系稳定的风险。",
      messages: {
        create: {
          role: "ASSISTANT",
          phase: "DIAGNOSIS",
          questionType: "CONCEPT_CLARIFICATION",
          content:
            "在开始前，请用自己的话说明你如何理解“系统性风险”，并说出一个你不确定的地方。",
        },
      },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
