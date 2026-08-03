# 问思学伴 ThinkTutor MVP 实施计划

## 0. 当前仓库状态

- 当前目录是一个新 Git 仓库：`No commits yet on master`。
- 仓库中除 `.git` 外没有应用代码、配置文件或文档。
- 未发现 `.openai/hosting.json`，本 MVP 暂不引入 Sites 托管配置。
- 当前阶段只做规划文档，不编写业务代码。

## 1. MVP 边界

目标是实现一个可运行的完整学习闭环，而不是静态演示或通用聊天框。

本轮 MVP 包含：

- 首页、创建任务页、学习会话页、学习报告页。
- 基于服务端状态机的学习流程：`DIAGNOSIS -> SOCRATIC -> FEYNMAN -> COMPLETED`。
- `AI_PROVIDER=mock` 的确定性本地模拟模型，保证无 API Key 时可完整演示和测试。
- `AI_PROVIDER=openai` 的服务端 OpenAI Provider，使用官方 Node.js SDK 与 Responses API。
- Prisma + SQLite 持久化会话、消息、报告。
- API、单元测试、集成测试、Playwright 端到端测试。
- README、架构文档、AI 行为文档、验收清单和 AGENTS.md。

明确不做：

- 登录、权限、教师后台。
- 文件上传、向量数据库、RAG 检索。
- 语音、实时协作、多课程管理。
- 独立 Python 后端。
- 浏览器端直接调用 OpenAI API。
- 复杂 UI 组件库或全局状态管理库。

## 2. 技术架构

推荐从空仓库初始化标准 Next.js App Router 项目：

- Next.js App Router + TypeScript strict。
- Tailwind CSS 用于页面样式。
- Prisma ORM + SQLite 本地数据库。
- OpenAI 官方 Node.js SDK，仅在 server-only AI 模块中使用。
- Zod 作为 API 输入、AI 输出和表单校验的单一校验层。
- Vitest 覆盖纯函数、schema、服务逻辑。
- Playwright 覆盖核心浏览器闭环。
- pnpm 作为唯一包管理器。

建议目录结构：

```text
app/
  page.tsx
  task/new/page.tsx
  session/[sessionId]/page.tsx
  report/[sessionId]/page.tsx
  api/
    sessions/route.ts
    sessions/[id]/route.ts
    sessions/[id]/answers/route.ts
    sessions/[id]/hint/route.ts
    sessions/[id]/feynman/route.ts
    sessions/[id]/retry/route.ts
    reports/[sessionId]/route.ts
components/
  ...
lib/
  ai/
    index.ts
    types.ts
    mock-provider.ts
    openai-provider.ts
    schemas.ts
  db.ts
  state-machine.ts
  scoring.ts
  api-response.ts
  validation.ts
prisma/
  schema.prisma
  seed.ts
tests/
  unit/
  integration/
e2e/
  thinktutor-flow.spec.ts
docs/
  PLAN.md
  ARCHITECTURE.md
  AI_BEHAVIOR.md
  ACCEPTANCE.md
```

关键约束：

- AI 模块必须通过 `server-only` 保护，禁止被客户端组件导入。
- 所有模型名从 `OPENAI_MODEL` 读取，业务代码中不硬编码具体模型名。
- 默认 `.env.example` 使用 `AI_PROVIDER=mock`。
- OpenAI 调用失败时返回可重试错误，不推进阶段、不增加轮数。

## 3. 数据模型

Prisma 模型建议包含三个核心表。

### LearningSession

字段建议：

- `id`: string cuid。
- `course`: string?，课程，可选。
- `chapter`: string?，章节，可选。
- `topic`: string，知识点，必填。
- `goal`: string，学习目标，必填。
- `learnerLevel`: string，学习者水平，必填。
- `referenceText`: string?，教师或课程参考材料，可选。
- `phase`: enum，`DIAGNOSIS | SOCRATIC | FEYNMAN | COMPLETED`。
- `socraticRound`: int，已完成苏格拉底回答轮数。
- `unknownStreak`: int，连续“不知道”或低信息回答次数。
- `feynmanExplanation`: string?。
- `parentSessionId`: string?。
- `createdAt`, `updatedAt`。

### Message

字段建议：

- `id`: string cuid。
- `sessionId`: string。
- `role`: enum，`USER | ASSISTANT | SYSTEM_EVENT`。
- `phase`: enum。
- `content`: string。
- `questionType`: enum?，仅 AI 追问和提示需要。
- `clientRequestId`: string?，用于重复提交防护。
- `createdAt`。

约束建议：

- `(sessionId, clientRequestId)` 唯一索引，`clientRequestId` 为空时不参与幂等判断。
- 每个会话最大消息数由服务端常量限制。

### LearningReport

字段建议：

- `id`: string cuid。
- `sessionId`: string unique。
- `summary`: string。
- `conceptScore`, `logicScore`, `clarityScore`, `exampleScore`, `transferScore`: int。
- `overallScore`: int，由服务端计算。
- `dimensionsJson`: JSON，保存五维证据与反馈。
- `masteredJson`: JSON string array。
- `gapsJson`: JSON string array。
- `nextStepsJson`: JSON string array，最多 3 项。
- `disclaimer`: string，固定免责声明。
- `createdAt`, `updatedAt`。

## 4. 状态机设计

所有状态转换放在纯函数中，并由 API 服务端调用。

核心函数建议：

- `canSubmitAnswer(session)`。
- `nextAfterDiagnosisAnswer(session)`。
- `nextAfterSocraticAnswer(session, aiSuggestion)`。
- `nextAfterFeynman(session)`。
- `canRequestHint(session)`。
- `canRetrySession(session)`。
- `computeUnknownStreak(answer, previousStreak)`。

状态规则：

- 创建会话时进入 `DIAGNOSIS`，并生成一个诊断问题。
- 提交诊断回答成功后进入 `SOCRATIC`。
- 苏格拉底阶段每次只生成一个主要问题。
- 苏格拉底回答轮数最少 3 轮，最多 5 轮。
- 模型只能返回 `REQUEST_FEYNMAN` 建议，最终是否进入 `FEYNMAN` 由服务端验证。
- 未满 3 轮时即使模型建议 `REQUEST_FEYNMAN`，服务端仍保持 `SOCRATIC`。
- 达到 5 轮后强制进入 `FEYNMAN`。
- 提交费曼讲解后生成报告并进入 `COMPLETED`。
- 再练一轮创建新会话，复制任务上下文并设置 `parentSessionId`。

幂等和失败规则：

- `clientRequestId` 必须由客户端生成并随提交发送。
- 服务端在事务内检查重复请求；重复请求返回已有结果，不重复写消息。
- AI 调用失败时不修改当前阶段、不增加 `socraticRound`、不写入不完整 AI 消息。
- 数据库事务负责用户消息、阶段转换、AI 消息和报告写入的一致性；若 AI 调用放在事务外，需要先记录幂等意图并用可恢复状态避免重复推进。

## 5. 苏格拉底追问策略

支持问题类型：

- `CONCEPT_CLARIFICATION`
- `CAUSE_PROBE`
- `ASSUMPTION_TEST`
- `COUNTEREXAMPLE`
- `TRANSFER`
- `SCAFFOLDED_HINT`

AI 输出约束：

- 每条 AI 回复只能包含一个主要问题。
- 不输出问题列表。
- 不给完整标准答案。
- 对学生输入和参考材料明确视为不可信内容。

连续“不知道”处理：

- 第一次：缩小问题范围。
- 第二次：提供线索或二选一框架。
- 第三次及以后：给出最小必要原理，但仍要求学生完成解释。

该逻辑应优先由服务端上下文和 Provider 输入约束控制，Mock Provider 必须覆盖完整行为。

## 6. API 设计

所有 API 返回统一结构：

```ts
type ApiSuccess<T> = { ok: true; data: T };
type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
  };
};
```

接口清单：

- `POST /api/sessions`
  - 创建学习会话。
  - 输入：任务字段。
  - 输出：session、初始诊断问题。

- `GET /api/sessions/:id`
  - 返回 session、messages、report summary 状态。

- `POST /api/sessions/:id/answers`
  - 提交诊断或苏格拉底阶段回答。
  - 输入：`answer`, `clientRequestId`。
  - 输出：更新后的 session 和新增消息。

- `POST /api/sessions/:id/hint`
  - 在 `DIAGNOSIS` 或 `SOCRATIC` 阶段申请提示。
  - 输入：`clientRequestId`。
  - 输出：一条 `SCAFFOLDED_HINT` AI 消息。

- `POST /api/sessions/:id/feynman`
  - 提交费曼讲解并生成报告。
  - 输入：`explanation`, `clientRequestId`。
  - 输出：report 和 completed session。

- `POST /api/sessions/:id/retry`
  - 针对最大漏洞再练一轮。
  - 输出：新 session，带 `parentSessionId`。

- `GET /api/reports/:sessionId`
  - 返回完整学习报告。

HTTP 状态码：

- `200`：读取或幂等重复请求成功。
- `201`：创建新 session 或 retry session 成功。
- `400`：Zod 校验失败。
- `404`：session 或 report 不存在。
- `409`：阶段不允许或幂等冲突。
- `429`：上游限流。
- `502`：AI 输出无效或被拒绝。
- `503`：AI 网络或超时错误，可重试。

## 7. 页面设计

整体风格：

- 白色背景。
- 低饱和度蓝绿色作为辅助色。
- 克制、清晰、教育产品风格。
- 不做营销型大首页，不做通用聊天软件外观。
- 桌面端和 375px 移动端都要可用。

页面：

- `/`
  - 项目名称。
  - 一句定位。
  - 四阶段流程。
  - “开始学习”按钮。

- `/task/new`
  - 课程、章节、知识点、学习目标、学习者水平、参考材料表单。
  - 客户端展示 Zod 校验结果，服务端 API 再校验一次。
  - 创建成功后跳转 `/session/[sessionId]`。

- `/session/[sessionId]`
  - 阶段进度和当前任务。
  - 对话消息列表。
  - 当前生成状态。
  - 错误与重试。
  - 提交按钮禁用状态。
  - 支持提示按钮。
  - 到 `FEYNMAN` 后切换为费曼讲解表单。
  - 页面刷新后从 API 重新加载完整状态。

- `/report/[sessionId]`
  - 主题、目标、总结。
  - 五维分数条、证据、反馈。
  - 已掌握内容、知识漏洞、最多三项建议。
  - 固定免责声明。
  - “针对最大漏洞再练一轮”按钮，成功后跳转新 session。

无障碍要求：

- 所有表单控件有 label。
- 按钮和输入支持键盘操作。
- 生成状态使用 `aria-live`。
- 阶段不仅靠颜色区分，必须有文字。
- 颜色对比度满足基本可读性。

## 8. AI Provider 设计

统一接口：

```ts
interface AIProvider {
  createDiagnosticQuestion(input: DiagnosticInput): Promise<DiagnosticQuestion>;
  createCoachTurn(input: CoachTurnInput): Promise<CoachTurn>;
  createLearningReport(input: ReportInput): Promise<LearningReportDraft>;
}
```

### MockAIProvider

- 默认开发和测试使用。
- 完全确定性，不使用随机数。
- 根据 `socraticRound`、`unknownStreak` 和 topic 生成单问题输出。
- 能走完诊断、3 到 5 轮追问、费曼讲解和报告。
- 生成报告时五维分数可基于输入长度、是否包含例子、是否有迁移表述等确定性规则。

### OpenAIProvider

- 仅服务端可导入。
- 从 `OPENAI_API_KEY`、`OPENAI_MODEL`、`AI_PROVIDER` 读取环境变量。
- 使用 OpenAI 官方 Node.js SDK 与 Responses API。
- 使用结构化输出，并用 Zod 二次校验。
- 设置超时。
- 捕获网络错误、限流、无效输出、拒绝输出。
- 错误日志不打印密钥和完整学生文本。
- 系统提示词、开发者规则、学生输入、参考材料分离传入。
- 明确标记学生输入和参考材料为不可信内容。
- 模型只建议 `CONTINUE` 或 `REQUEST_FEYNMAN`，服务端状态机最终裁决。

## 9. 测试计划

### 单元测试

- 状态机转换。
- 最少 3 轮和最多 5 轮追问规则。
- 模型提前建议 `REQUEST_FEYNMAN` 时服务端拒绝提前进入费曼阶段。
- 五维平均分计算和四舍五入。
- Zod schema 成功和失败路径。
- 学生回答长度验证。
- 重复请求处理。

### 集成测试

- 创建会话并生成诊断问题。
- 提交诊断回答后进入 `SOCRATIC`。
- 完成模拟追问并进入 `FEYNMAN`。
- 提交费曼讲解生成报告并进入 `COMPLETED`。
- 创建再练任务并设置 `parentSessionId`。
- AI 失败时不推进阶段、不增加轮数。

### Playwright E2E

- 打开首页。
- 创建学习任务。
- 提交诊断回答。
- 完成 mock 追问。
- 提交费曼讲解。
- 打开报告。
- 点击再练一轮。
- 验证新会话与原会话有关联。

## 10. 文档计划

需要创建或更新：

- `AGENTS.md`：本项目协作约定、命令、架构边界。
- `README.md`：定位、技术栈、环境、安装、变量、数据库、mock/OpenAI 运行、测试、构建、常见错误、MVP 限制。
- `docs/PLAN.md`：本实施计划。
- `docs/ARCHITECTURE.md`：系统结构、数据流、状态机、事务策略。
- `docs/AI_BEHAVIOR.md`：AI 输出契约、安全约束、mock/openai 差异。
- `docs/ACCEPTANCE.md`：验收标准与实际验证记录。

## 11. 具体实施顺序

1. 初始化 Next.js + TypeScript + Tailwind + pnpm 项目骨架。
2. 开启 strict TypeScript、配置 ESLint、Vitest、Playwright。
3. 配置 Prisma + SQLite，定义 schema、migration、seed。
4. 实现 Zod schema、统一 API 响应、错误类型。
5. 实现纯状态机和评分工具，并先写单元测试。
6. 实现 MockAIProvider，并用单元测试固定输出行为。
7. 实现数据库访问层和 API 路由。
8. 实现 OpenAIProvider，接入 Responses API 和结构化输出校验。
9. 实现四个页面和基础组件。
10. 编写集成测试和 Playwright 核心闭环测试。
11. 补齐 README、ARCHITECTURE、AI_BEHAVIOR、AGENTS。
12. 执行并记录验证：`pnpm install`、migration、seed、lint、test、build、Playwright。

## 12. 风险点与处理

- OpenAI Responses API 结构化输出细节可能随 SDK 版本变化：实现 OpenAIProvider 前应核对官方文档，并将解析逻辑集中封装。
- AI 调用和数据库事务边界需要谨慎：不能在 AI 失败时留下错误阶段或错误轮数。
- 重复提交防护不能只依赖前端禁用按钮：必须用 `clientRequestId` 和数据库唯一约束兜底。
- SQLite JSON 字段类型能力有限：若 Prisma 当前 SQLite JSON 支持受限，则用字符串保存 JSON，并在服务层 Zod 解析。
- Playwright 与 Next dev server 启动耗时可能影响 CI：需要稳定的 webServer 配置和 mock 模式。
- “不知道”识别不能过度复杂：MVP 采用确定性低信息回答检测规则，避免引入额外模型判断。
- 报告分数必须由服务端计算 overallScore：模型输出或 mock 输出不得包含 overallScore。
- 页面刷新保留状态依赖服务端数据完整性：会话页不要把流程状态只存在 React state 中。

## 13. 需要审查的关键决策

- 空仓库初始化为单体 Next.js App Router 项目，API Routes 同仓实现后端能力。
- 默认 `AI_PROVIDER=mock`，OpenAI 模式作为可选真实模型路径。
- 再练一轮创建全新 session，并用 `parentSessionId` 关联原 session，而不是复用原会话。
- `referenceText` 存入数据库并作为不可信学习材料传给模型，不做文件上传或向量化。
- 报告维度细节存 JSON，overallScore 由服务端计算后存独立字段。
- 幂等采用客户端 `clientRequestId` + 数据库唯一约束 + 服务端重复请求返回已有结果。
