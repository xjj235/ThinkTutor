# ThinkTutor 项目已完成内容总览

更新时间：2026-08-22

## 1. 核对依据

本文件用于对照项目计划书、`AGENTS.md`、`docs/PLAN.md`、`docs/ARCHITECTURE.md`、`docs/AI_BEHAVIOR.md`、`docs/ACCEPTANCE.md` 以及当前仓库实现，整理 ThinkTutor 已经完成的工程与产品能力。

项目目标保持为“问思学伴 ThinkTutor”：以教师布置的学习任务为入口，通过诊断问题、苏格拉底追问、费曼讲解和形成性报告，帮助学生主动建构理解，并允许从最高优先级知识漏洞再次练习。

核心闭环：

```text
任务创建
→ 初始诊断
→ 3～5 轮苏格拉底追问
→ 费曼讲解
→ 形成性学习报告
→ 针对最高优先级漏洞再练一轮
```

## 2. 总体完成状态

项目已经从最小 MVP 扩展为一个可通过 HTML 网页访问的完整 Web 应用原型，并保留同一套代码用于本地预览和阿里云生产部署。

已完成的核心能力包括：

- Next.js + TypeScript + Tailwind + pnpm 工程化基础；
- Prisma + PostgreSQL 数据层；
- 学习状态机与服务端阶段校验；
- Mock 与 DeepSeek AI Provider；
- 知识库优先、联网辅助的回答链路；
- 学生、教师、管理员三个角色的 HTML 页面；
- 任务、学习会话、报告、再练一轮闭环；
- 课程、章节、学习目标、班级、作业、材料、审计与后台管理；
- 本地一键预览；
- 阿里云 ECS + RDS + Tair + OSS + HTTPS + DeepSeek 的生产部署边界文档；
- 单元、集成、端到端与 DeepSeek 冒烟测试。

## 3. 基础工程已完成

已完成内容：

- 使用 pnpm 作为唯一包管理器；
- 使用 Next.js App Router；
- 启用 TypeScript strict；
- 使用 Tailwind CSS 构建中文教育产品界面；
- 配置 Prisma、PostgreSQL、Zod、Vitest 和 Playwright；
- 配置 lint、test、build、e2e、preview 等脚本；
- 创建并维护 `AGENTS.md`，沉淀长期工程规则；
- 创建 `.env.example`，区分本地、测试和生产环境变量；
- 更新 README，提供本地预览、开发、测试和生产部署说明；
- 保留 `.gitignore`，避免提交 `.env`、本地数据库、构建产物和密钥。

关键文件：

- `package.json`
- `tsconfig.json`
- `next.config.ts`
- `postcss.config.mjs`
- `eslint.config.mjs`
- `playwright.config.ts`
- `vitest.config.ts`
- `AGENTS.md`
- `README.md`
- `.env.example`

## 4. 数据层已完成

已完成内容：

- 使用 Prisma 建模核心学习数据；
- 使用 PostgreSQL 作为主要数据库；
- 已包含学习会话、消息、报告等核心表；
- 已包含用户、角色、课程、章节、学习目标、班级、作业、材料、AI 使用记录、审计日志等扩展业务表；
- 已配置级联删除，保证会话、消息、报告等关联数据一致性；
- JSON 字段在 TypeScript 和 Zod 层有结构化类型约束；
- 创建并运行数据库 migration；
- 创建幂等 seed 脚本，用于本地预览和开发初始化；
- 本地预览使用工作区内持久化 PostgreSQL 数据目录，不回退到 SQLite。

核心模型覆盖：

- `LearningSession`
- `Message`
- `LearningReport`
- `User`
- `Course`
- `Chapter`
- `LearningGoal`
- `Classroom`
- `Assignment`
- `Material`
- `AiUsage`
- `AuditLog`

核心枚举覆盖：

- `LearningPhase`
- `MessageRole`
- `QuestionType`
- 用户角色、任务状态、材料状态、AI Provider 等业务枚举。

关键文件：

- `prisma/schema.prisma`
- `prisma/seed.ts`
- `prisma/migrations/`
- `src/lib/db.ts`
- `src/types/learning.ts`

## 5. 学习状态机已完成

已完成内容：

- 学习阶段转换使用纯函数实现；
- 服务端负责最终阶段判断，前端不直接决定阶段；
- 支持 `DIAGNOSIS`、`SOCRATIC`、`FEYNMAN`、`COMPLETED`；
- 首次诊断回答后进入苏格拉底阶段；
- 苏格拉底追问最少 3 轮、最多 5 轮；
- 模型只能建议进入费曼阶段，服务端最终决定；
- 第 5 轮后服务端强制进入费曼阶段；
- AI 调用失败时不推进阶段、不增加追问轮数；
- 费曼讲解成功后生成并保存形成性报告；
- 再练一轮根据最高优先级知识漏洞创建新会话，并设置父会话关系。

关键文件：

- `src/lib/state-machine.ts`
- `src/lib/session-service.ts`
- `src/lib/report-service.ts`
- `tests/state-machine.test.ts`

## 6. AI Provider 层已完成

已完成内容：

- 定义统一 AI Provider 接口；
- 实现确定性 `MockAIProvider`，用于本地开发和自动化测试；
- 实现 DeepSeek Provider，用于生产和真实 AI 调用；
- 支持通过环境变量选择 `AI_PROVIDER=mock` 或 `AI_PROVIDER=deepseek`；
- 模型名从环境变量读取，不在前端硬编码；
- API Key 只在服务器端读取，不进入浏览器包；
- 对 AI 输入进行边界包装，明确区分系统规则、参考材料和学生输入；
- 对 AI 输出进行 Zod 二次验证；
- 对超时、限流、网络失败和无效输出进行统一处理；
- 加入必要日志，但不记录密钥、Cookie、Token 或真实敏感输入；
- 报告 `overallScore` 不由模型生成，而由服务端根据五维分数平均计算；
- 报告每个维度必须包含证据和反馈；
- 未展示能力时不得虚构掌握证据。

已完成的结构化输出：

- 诊断问题 Schema；
- 苏格拉底追问 Schema；
- 学习报告 Schema；
- Web 来源 Schema；
- 知识检索上下文 Schema。

关键文件：

- `src/lib/ai/provider.ts`
- `src/lib/ai/mock-provider.ts`
- `src/lib/ai/deepseek-provider.ts`
- `src/lib/ai/schemas.ts`
- `src/lib/ai/prompts/tutor.ts`
- `src/lib/ai/prompts/report.ts`
- `src/lib/ai/search-policy.ts`
- `docs/AI_BEHAVIOR.md`

## 7. 知识库优先与联网辅助已完成

已完成内容：

- AI 回答链路优先检索项目内已有知识库或教师材料；
- 命中知识库后仍允许联网辅助，用于补充和校准；
- 未命中知识库时，可使用 DeepSeek 的联网搜索能力或搜索增强能力；
- 当知识库与网页结果冲突时，设计为对比后校准，而不是直接覆盖；
- 页面展示网页来源时只显示经过校验的安全 HTTPS 链接；
- 不把知识库内容、API Key、数据库密码或对象存储凭据暴露到前端；
- 将知识库、联网来源和学生输入作为不可信内容处理，不能覆盖系统提示词。

关键文件：

- `src/lib/retrieval/`
- `src/lib/materials/`
- `src/lib/ai/deepseek-provider.ts`
- `src/lib/ai/schemas.ts`
- `src/components/learning-chat.tsx`

## 8. API 与业务流程已完成

已完成内容：

- API 输入统一使用 Zod 校验；
- API 错误使用统一错误格式；
- 创建会话时自动生成诊断问题；
- 提交首个回答后进入苏格拉底阶段；
- 提示、回答、费曼讲解、报告生成和再练一轮均经过服务端校验；
- 支持 `clientRequestId` 防止双击或网络重试产生重复消息；
- 关键更新使用一致性策略，避免重复提交导致状态错乱；
- AI 失败不会增加轮数或推进阶段；
- 报告读取按会话授权校验；
- 作业开放时间、截止时间、最大尝试次数和继续学习入口由服务端校验。

核心 API：

- `POST /api/sessions`
- `GET /api/sessions/[sessionId]`
- `POST /api/sessions/[sessionId]/answers`
- `POST /api/sessions/[sessionId]/hint`
- `POST /api/sessions/[sessionId]/feynman`
- `POST /api/sessions/[sessionId]/feynman/enter`
- `POST /api/sessions/[sessionId]/retry`
- `GET /api/reports/[sessionId]`

扩展 API：

- 登录、注册和当前用户；
- 学生仪表盘、作业、班级、学习历史和学习档案；
- 教师课程、章节、目标、班级、作业、材料和分析；
- 管理员用户、材料、AI 使用、审计和系统状态。

关键目录：

- `src/app/api/`
- `src/lib/api/`
- `src/lib/auth/`
- `src/lib/authorization.ts`
- `src/lib/errors.ts`
- `src/lib/validation.ts`

## 9. HTML 前端页面已完成

项目已经不是 API-only 或 CLI-only；主要功能均可通过 HTML 网页访问。

已完成页面：

- `/`：产品首页和成果入口；
- `/login`：登录；
- `/register`：注册；
- `/dashboard`：按角色进入对应工作台；
- `/learn/new`：学生创建学习任务；
- `/task/new`：兼容早期任务创建入口；
- `/session/[sessionId]`：完整学习会话页；
- `/report/[sessionId]`：形成性学习报告页；
- 学生作业、班级、学习历史、学习档案页面；
- 教师课程、章节、学习目标、材料、班级、作业、分析页面；
- 管理员用户、AI 使用、材料、审计、系统页面。

前端交互已覆盖：

- 表单必填提示；
- 字数提示；
- 错误反馈；
- 提交中状态；
- 可重试错误；
- 防重复提交；
- 四阶段进度条；
- 当前问题类型中文标签；
- 费曼阶段大文本框；
- 报告五维分数条；
- 证据、反馈、已掌握内容、知识漏洞和下一步任务；
- 形成性反馈免责声明；
- 针对最大漏洞再练一轮。

界面约束已落实：

- 中文界面；
- 白色背景；
- 低饱和蓝绿色教育风格；
- 避免强渐变、玻璃拟态和无意义动画；
- 不使用通用聊天软件式布局作为唯一产品表达；
- 桌面端和 375px 移动端适配；
- 所有主要按钮、链接和表单具备可访问名称；
- 不使用 `dangerouslySetInnerHTML`。

关键目录：

- `src/app/`
- `src/components/`

## 10. 本地预览已完成

已完成内容：

- 新增 `pnpm preview`；
- 本地自动启动工作区内持久化 PostgreSQL；
- 数据保存在 `.local-preview/`，停止后保留；
- 自动执行 Prisma production migration；
- 自动执行幂等 development seed；
- Seed 提供学生、教师、管理员三个角色；
- Seed 提供课程、章节、学习目标、班级和已发布任务；
- 本地预览固定使用 `AI_PROVIDER=mock`，不产生 AI 费用；
- 使用本地签名存储，不依赖真实 OSS；
- 启动后打印网页地址、演示账号、统一密码、数据位置和停止方式；
- 提供局域网预览命令，但明确仅限可信网络；
- 生产模式不会在首页显示演示账号和密码。

关键文件：

- `scripts/local-preview.ts`
- `scripts/preview-check.ts`
- `scripts/with-test-postgres.ts`
- `README.md`
- `docs/LOCAL_PREVIEW_PROMPT.md`

## 11. 阿里云生产部署准备已完成

已完成内容：

- 明确生产部署使用同一套 Next.js 页面、API、Prisma 模型和权限规则；
- 明确生产入口为 Nginx HTTPS 域名；
- Next.js 仅作为内部服务运行在 3000 端口；
- RDS、Tair、OSS 和 DeepSeek 只在服务端访问；
- 生产环境使用私有 OSS，不把对象存储凭据暴露给浏览器；
- 生产环境禁止 development seed；
- 生产环境要求强 Secret；
- 生产配置要求使用 `DEPLOYMENT_ENV=production`；
- DeepSeek 生产模式使用 `AI_PROVIDER=deepseek`；
- DeepSeek 模型名从环境变量读取；
- README 和部署文档包含生产启动、迁移、反向代理和环境变量说明。

关键文件：

- `docs/ALIYUN_DEPLOYMENT.md`
- `docs/FINAL_PRODUCTION_REVIEW.md`
- `README.md`
- `.env.example`
- `src/lib/env.ts`
- `src/lib/storage/`

## 12. 安全与隐私已完成

已完成内容：

- API Key、数据库密码、对象存储密钥只允许服务端读取；
- 前端不暴露 `DEEPSEEK_API_KEY`、`DATABASE_URL`、`OSS_ACCESS_KEY_SECRET` 等敏感变量；
- 防止把学生输入、参考材料或网页内容当作系统指令执行；
- AI Provider 不记录密钥；
- 用户、教师和管理员 API 均有角色和资源归属校验；
- 支持 Same-Origin 检查；
- 支持请求限流和锁机制；
- Redis/Tair 不可用时有本地内存降级方案；
- 使用 `clientRequestId` 保证幂等；
- 上传材料、管理操作和危险操作进入审计链路；
- 生产 seed 禁止执行；
- 本地预览账号只存在于 development seed；
- 不提交 `.env` 或真实密钥。

关键文件：

- `src/lib/auth/`
- `src/lib/authorization.ts`
- `src/lib/security/`
- `src/lib/rate-limit.ts`
- `src/lib/server-lock.ts`
- `src/lib/audit.ts`
- `src/lib/env.ts`

## 13. 测试与验证已完成

自动化测试覆盖范围：

- 状态机；
- 报告五维平均分；
- AI 输出 Schema；
- Mock AI Provider；
- 会话 API；
- 报告 API；
- 权限和认证；
- 作业规则；
- 材料上传和异常处理；
- 管理员用户操作；
- 教师任务和学生进度；
- 学习历史和学习档案；
- 完整学习闭环端到端测试；
- 页面刷新后的数据持久化；
- API 错误重试；
- 重复请求去重；
- 移动端布局；
- DeepSeek 真实接口冒烟测试。

最近一次已知验证结果：

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm test` | 通过，16 个测试文件通过，1 个跳过；71 个断言通过，2 个跳过 |
| `pnpm build` | 通过，生成 47 个页面 |
| `pnpm e2e` | 通过，24 个端到端测试通过 |
| `pnpm test:deepseek:live` | 通过，1 个测试文件、2 个测试通过 |

关键目录：

- `tests/`
- `e2e/`

## 14. 当前尚未完成或仍需真实环境验收的内容

以下内容不应被描述为已经完全上线完成：

- 尚未在真实阿里云 ECS + RDS + Tair + OSS + HTTPS 全链路环境中完成最终生产验收；
- DeepSeek 真实联网能力已经有冒烟验证基础，但仍需要在真实套餐、真实额度、真实网络条件下做长时间稳定性、成本和限流验证；
- 生产级备份、恢复演练、日志留存周期、告警阈值和运维 SOP 仍需在云环境中落地；
- 当前产品是 HTML Web 应用，不包含原生 iOS、Android、小程序或语音交互；
- 当前学习报告是形成性反馈，不是标准化测评、考试评分、心理诊断或医学诊断；
- 不应把本地预览 HTTP、演示账号或局域网预览当作公网生产方案。

## 15. 下一阶段最值得继续完善的功能

建议按优先级继续推进：

1. 完成真实阿里云上线验收\
   使用生产 RDS、Tair、OSS、ECS、HTTPS 和 DeepSeek Key，跑通注册、登录、教师发布任务、学生学习闭环、报告、再练一轮、材料上传和管理员审计。

2. 完善生产运维能力\
   增加备份恢复演练、日志脱敏检查、监控告警、成本监控、AI 调用失败率统计和异常追踪。

3. 强化教学闭环质量\
   增加教师对报告维度、知识漏洞、班级共性问题和任务效果的复盘页面，同时继续保持“学生主动表达、AI 追问引导、教师主导任务”的产品边界。

## 16. 结论

ThinkTutor 已经完成从 MVP 学习闭环到多角色 HTML Web 应用的主要工程实现。本地可以通过浏览器查看成果，生产部署方案也已经围绕阿里云和 DeepSeek 做了明确边界设计。

当前最关键的剩余工作不是重新搭建应用，而是在真实云资源和真实 DeepSeek 生产环境中做最终上线验收，并补齐生产运维验证。
