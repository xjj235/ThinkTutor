# 问思学伴 ThinkTutor MVP 验收记录

## 验收状态

- 状态：MVP 已实现并完成 mock 模式验证。
- 验证日期：2026-08-02。
- 验证环境：Windows、Node.js 24.14.0、pnpm 11.9.0。
- 数据库：Prisma 7.9.1 + SQLite。
- AI 模式：`AI_PROVIDER=mock`。

## 功能验收

- [x] 首页展示项目定位、四阶段流程和“开始学习”入口。
- [x] 新建任务页包含课程、章节、知识点、学习目标、学习者水平和参考材料。
- [x] 表单与 API 输入均使用 Zod 校验并设置文本长度上限。
- [x] 服务端状态机执行 `DIAGNOSIS -> SOCRATIC -> FEYNMAN -> COMPLETED`。
- [x] 苏格拉底阶段每轮只有一个主要问题，至少 3 轮、最多 5 轮。
- [x] 连续低信息回答触发缩小范围、二选一线索、最小必要原理三档支持。
- [x] 费曼讲解生成五维报告，`overallScore` 由服务端计算。
- [x] 报告包含证据、反馈、掌握内容、知识漏洞、下一步建议和固定免责声明。
- [x] “针对最大漏洞再练一轮”创建带 `parentSessionId` 的新会话。
- [x] 会话、消息、报告和再练关联持久化，刷新页面后可恢复。
- [x] 回答、提示、费曼讲解和再练接口均处理重复请求。

## API 验收

- [x] `POST /api/sessions`
- [x] `GET /api/sessions/:id`
- [x] `POST /api/sessions/:id/answers`
- [x] `POST /api/sessions/:id/hint`
- [x] `POST /api/sessions/:id/feynman`
- [x] `POST /api/sessions/:id/retry`
- [x] `GET /api/reports/:sessionId`
- [x] 统一 JSON 响应和明确 HTTP 状态码。
- [x] 动态路由参数与请求体均经过 Zod 校验。
- [x] AI 失败不推进阶段、不增加轮数。

## AI 与安全验收

- [x] 统一 `AIProvider` 接口，包含 `OpenAIProvider` 和 `MockAIProvider`。
- [x] Mock 输出确定且可完成完整闭环。
- [x] OpenAI Provider 使用官方 Node.js SDK、Responses API 和结构化输出。
- [x] 模型仅从 `OPENAI_MODEL` 读取，密钥仅从服务端环境读取。
- [x] 设置 15 秒超时并映射限流、网络、拒绝、空输出和无效输出错误。
- [x] 学生输入和参考材料被明确标记为不可信内容。
- [x] 不使用 `dangerouslySetInnerHTML`，不记录密钥或完整敏感文本。
- [x] `.env` 被忽略，仓库提供 `.env.example`。

## 数据与界面验收

- [x] Prisma migration 创建 `LearningSession`、`Message`、`LearningReport`。
- [x] seed 创建“系统性风险”演示任务。
- [x] 桌面与移动端均展示阶段、进度、任务、消息、生成、错误和禁用状态。
- [x] 报告包含五维分数条。
- [x] 表单有 label，交互可用键盘操作，阶段不只依靠颜色表达。
- [x] Playwright 同一闭环覆盖桌面 Chrome 与移动 Chrome 视口。

## 自动验证

以下命令均已实际运行：

```bash
pnpm install
pnpm prisma:migrate
pnpm prisma:seed
pnpm lint
pnpm test
pnpm build
pnpm exec playwright test
```

验证结果：

- [x] `pnpm install` 成功，Prisma Client 在 postinstall 生成。
- [x] migration 成功，初始 migration 已应用。
- [x] seed 成功。
- [x] `pnpm lint` 通过。
- [x] `pnpm test`：5 个测试文件、13 项测试通过。
- [x] `pnpm build` 通过，无 TypeScript 错误。
- [x] Playwright：桌面与移动项目 2 项均通过。
- [x] Playwright webServer 实际启动 `pnpm dev` 并完成闭环。
- [x] 无硬编码密钥，无核心 TODO。

本机 Playwright 验证使用已安装 Chrome，通过
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定可执行文件；标准 CI 可运行
`pnpm exec playwright install chromium` 后直接执行测试。
