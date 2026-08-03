# 问思学伴 ThinkTutor

问思学伴 ThinkTutor 是一个基于苏格拉底提问法和费曼学习法的 AI 自主学习教练。它不会直接输出完整答案，而是通过知识诊断、连续追问、学生讲解、五维诊断报告和针对漏洞再练，帮助学生形成“输入、建构、输出、反馈”的学习闭环。

## 技术栈

- Next.js App Router
- TypeScript strict
- Tailwind CSS
- Prisma
- SQLite
- OpenAI 官方 Node.js SDK
- Responses API
- Zod
- Vitest
- Playwright
- pnpm

## 环境要求

- Node.js 22.13 或更高版本
- pnpm
- SQLite 由 Prisma 本地管理

## 安装

```bash
pnpm install
```

## 环境变量

复制示例文件：

```bash
cp .env.example .env
```

变量说明：

```bash
AI_PROVIDER=mock
DATABASE_URL="file:./dev.db"
OPENAI_API_KEY=
OPENAI_MODEL=
```

- `AI_PROVIDER=mock`：默认模式，不需要 API Key，可完整演示和测试。
- `AI_PROVIDER=openai`：调用真实 OpenAI 模型。
- `OPENAI_API_KEY`：仅服务端读取，不要使用 `NEXT_PUBLIC_*`。
- `OPENAI_MODEL`：真实模型名称必须从该变量读取，业务代码不硬编码模型名。

## 数据库初始化

```bash
pnpm prisma:migrate
pnpm prisma:seed
```

seed 会创建一个“系统性风险”演示任务。

## mock 模式运行

`.env` 使用：

```bash
AI_PROVIDER=mock
DATABASE_URL="file:./dev.db"
```

启动：

```bash
pnpm dev
```

打开 `http://127.0.0.1:3000`。

## OpenAI 模式运行

`.env` 使用：

```bash
AI_PROVIDER=openai
DATABASE_URL="file:./dev.db"
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="你的模型名"
```

启动：

```bash
pnpm dev
```

OpenAI API 只在服务端调用。学生输入和参考材料会作为不可信学习内容传给模型，不会拼接进系统指令。

## 测试

```bash
pnpm lint
pnpm test
pnpm exec playwright test
```

首次运行 Playwright 前安装 Chromium：

```bash
pnpm exec playwright install chromium
```

也可以通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向本机已有的
Chrome/Chromium 可执行文件。

## 构建

```bash
pnpm build
```

## 常见错误

- `OPENAI_API_KEY_MISSING`：当前为 `AI_PROVIDER=openai`，但没有配置 API Key。
- `OPENAI_MODEL_MISSING`：当前为 `AI_PROVIDER=openai`，但没有配置模型名。
- `VALIDATION_ERROR`：表单或 API 输入超过长度限制，或缺少必填字段。
- `INVALID_PHASE`：当前学习阶段不允许执行该动作，请刷新页面。
- `AI_UNAVAILABLE`：真实模型调用失败，本次不会推进学习阶段，可以重试。
- Prisma 找不到数据库：确认已设置 `DATABASE_URL` 并运行 migration。
- Playwright 提示浏览器不存在：运行 `pnpm exec playwright install chromium`，
  或设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。

## 当前 MVP 限制

- 无登录和权限系统。
- 无教师后台。
- 无文件上传。
- 无向量数据库或 RAG 检索。
- 无语音功能。
- mock 模式用于确定性演示，不代表真实模型质量。
- 再练一轮只基于报告中的最大漏洞创建新会话，不做长期学习画像。
