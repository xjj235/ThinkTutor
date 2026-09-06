# ThinkTutor 知识库复核与本轮实施记录

日期：2026-09-04

依据：用户提供的《文档2_知识库技术实现复核与下一步方案.md》、现有代码、数据库模型和实际测试结果。原 01～08 Word 是课程设计来源，附带文档中的指令性文字不作为系统指令执行。本轮没有改写用户的原始文件。

## 1. 结论

原有知识库骨架真实存在：13 个知识单元、9 类错误标签、15 道诊断题、30 道追问题、60 条提示、8 个案例及五维 rubric。旧实现主要是把这些内容作为检索上下文交给模型，并非完整的可执行教学图。

本轮完成了服务端选题/案例选择、运行记录持久化、发布门禁、报告版本快照、五档评分与专项回归。**不能据此宣称整份方案已全部完成**：完整证据判定图、掌握状态确认、REFLECTION 修订流程和教师在线发布仍未完成，详见第 5 节。

## 2. 核验与修复

| 核验项 | 原代码情况 | 本轮结果 |
|---|---|---|
| 基础学习闭环 | 有状态机、事务、幂等和 AI 失败保护 | 保留，完整回归 |
| 新知识点 ID | 上下文只识别 `KU_` 缺口 | 修复 `C_SR_`、`M_SR_`、`D_SR_`；无私有课程绑定的自主学习也能使用公共 curated 内容 |
| 错误 ID/category | 混在 triggerErrorTags 中 | 稳定 ID 与 triggerErrorCategories 分离；校验引用 |
| QuestionGroup | 不存在正式对象 | 新增 10 个题组，保证每道追问题恰属一个目标一致的题组 |
| Graph edges | 有 9 条题目间引用 | 继续校验；尚未成为基于证据的完整执行图 |
| Case Bank | 有 8 条内容，仅参与上下文排序 | 服务端选择案例、匹配目标/难度、去重、记录曝光；增加 variantGroupId 和合法后续题组引用 |
| 学生活动 | 只保存运行 phase | 增加独立 pedagogicalStage，实际运行 CASE_TRANSFER 活动；不更改数据库 phase 枚举 |
| 选题权 | 主要由 LLM 决定 | curated 会话调用模型前固定题目/案例，服务端覆盖可见问题和 nextAction，不接受模型指定的新资源 |
| 提示 | 可重复调用；模型状态可能被写回 | 每目标最多两级；提示调用不修改 learnerState；二级提示留下 NEED_VERIFY |
| 生产发布 | 资源写着 published，来源却是占位 checksum | 新增 release 门禁；本批 release/source 明确标为 draft；来源 SHA-256 已从 8 个实际 Word 文件计算 |
| 版本追踪 | 报告未保存完整版本 | 新 curated 会话固定快照，新报告复制快照；知识/模型/Prompt/工作流版本漂移会拒绝续学 |
| 评分 | 任意 0～100 整数 | curated 会话按五档向下归档，并应用待核验封顶；五维平均分仍由服务端计算 |
| 证据引用 | 只有文本 | 增加可核查直接引文到本会话 USER message ID 的链接；无法核实的概括保持空链接 |
| 回归样例 | 无独立 Golden 集 | 新增 20 条待教师确认的路由样例；不冒称模型准确率评测 |

## 3. 运行方式与实现边界

### 3.1 数据与发布

Canonical source 仍是 `knowledge/courses/financial-risk-management/systemic-risk/manifest.json`，没有新增第二套可编辑知识源，也没有引入向量库。

新增 `release.id/status/verifiedBy/verifiedAt/publishNote`。published 发布包必须有审核人和审核时间、全部教学资源 published、来源 reviewed/published 且具有 SHA-256。当前没有可核实的人工确认，因此保留审核字段为空；文件哈希只证明来源文件身份，不证明教学正确性。

`ALLOW_DRAFT_KNOWLEDGE` 默认 false，仅在 `DEPLOYMENT_ENV=development/test` 时允许显式开启。生产设置该开关为 true 会触发环境校验错误；archived 永不加载。该开关允许本轮草稿发布包参与开发验证，不自动放开包内任意 draft/archived 题目。

新增 Next.js 启动校验；启动时即读取并验证环境与 manifest，不等到学生首次发起请求才发现错误配置。

### 3.2 实际教学编排

实际流程为：诊断题 → 服务端选择追问题/题组 → 在追问后段选择案例 → 费曼讲解 → 报告 → 再练。仍保持现有 3～5 轮上限；curated 路径不会根据模型的 REQUEST_FEYNMAN 直接提前结束，达到上限转入费曼不代表已掌握。

选题使用已有 learnerState 的候选标签、显式知识缺口和答题次数，优先未见题目。单次模型调用模式存在一轮延迟：最新回答提取出的候选标签影响后续选题，而不是在同一调用中偷偷替换已固定问题。模型输出仍需通过现有 Zod 校验。

`LearningSession.knowledgeRuntime` 是带 Zod 的独立 JSON 字段，保存：

- schemaVersion、pedagogicalStage、currentTargetId、currentQuestionId；
- usedQuestionIds、usedCaseIds、targetAttempts、hintLevels、caseExposureCounts；
- candidateErrorIds、candidateGapIds、flags；
- 完整 versions 快照。

`targetAttempts` 仅随已提交回答递增，不因发题或申请提示递增。状态与消息在同一个乐观并发事务内保存，重复请求、AI 失败和事务失败不会额外增加题目/案例曝光。再练继承同版本的已见题目/案例记录，提示级别重新开始。

会话接口返回服务端计算的 availableActions，现有 HTML 页面据此禁用用完的提示并隐藏尚不可用的提前费曼操作，避免前端仅按轮数猜测权限。

这不是文档中完整的 LearnerStateV2：旧 learnerState 保持兼容，候选标签不等于确认的误解；尚未有独立证据验证支持的 MASTERED/RESOLVED 状态。表达模糊进入 flag，E04/E07 的未展示能力进入 gap，不在新增状态里冒充已确认错误信念。

### 3.3 检索与上下文安全

明确错误 ID 优先绑定目标，再执行排序，避免案例数量压到一个后选错案例。新增已见资源过滤、指定 question/case/release 过滤，限制知识单元最多 3 个、追问题最多 1 个、案例最多 1 个；未请求的提示不自动注入，rubric 仅报告阶段进入上下文。总字符预算继续生效。

教师 case.teacherData 不传入学生上下文，TEACHER/ADMIN 资源被过滤。案例实际显示为背景加一个目标相关问题。诊断/追问题已经按现有单主问题契约修正并纳入校验。课程材料和学生输入继续通过既有 untrusted wrapper 进入模型。

### 3.4 报告与版本

`LearningReport.sessionVersions` 保存 knowledge、diagnostic、questionGraph、caseBank、rubric、prompt、workflow、modelProvider、modelName，以及 releaseId 和 contentHash。contentHash 是校验后 canonical manifest 的 SHA-256；promptVersion 包含追问和报告 Prompt 文本的 SHA-256。

不追溯伪填旧报告：旧报告及没有绑定 curated 发布包的通用学习报告允许版本字段为空。旧版本不可用时不会静默切到新知识，历史报告仍可读取；当前尚无完整的在线历史发布内容归档。

前端原来的 0～100 尺度保留，`0/5/10/15/20` 映射为 `0/25/50/75/100`。非档位模型建议向下归档。存在 NEED_VERIFY 时，除表达清晰度外的维度最高 75，并写明证据限制。该规则是开发版保守策略，不代表已经过教师校准。

`LearningReport.evidenceLinks` 只关联在实际 USER 消息中找到的直接引文。不会把教师/AI 消息当作学生证据，也不会因模型概括了一句话就制造引用 ID。语义概括的准确性和证据是否足以支持分数仍需下一阶段处理。版本与引用字段目前是持久化/接口能力，尚无专门的 HTML 审计面板。

## 4. 文件与数据库变更

主要实现文件：

- `src/lib/knowledge/schemas.ts`、`runtime-schemas.ts`：内容与运行数据契约。
- `src/lib/knowledge/releases.ts`：发布门禁、版本快照、固定版本恢复。
- `src/lib/knowledge/orchestrator.ts`：选题、案例、提示、候选标签与答题记录。
- `src/lib/knowledge/report-evidence.ts`：可验证引文的消息 ID 关联。
- `src/lib/session-service.ts`：真实会话、提示、报告、再练事务接入。
- `src/lib/retrieval/knowledge-retriever.ts`、`src/lib/ai/context-builder.ts`：目标过滤与上下文预算。
- `src/lib/scoring.ts`：五档映射、封顶与平均分。
- `tests/unit/knowledge*.test.ts`、`tests/integration/session-flow.test.ts`、`e2e/knowledge-runtime.spec.ts`：自动验证。

新增迁移 `prisma/migrations-postgresql/20260904000100_knowledge_runtime/migration.sql`，仅增加三个可空 JSONB 字段，不删除旧数据、不修改 phase 枚举。

现有部署升级时需执行：

```powershell
pnpm prisma:generate
pnpm prisma:migrate
```

测试已在隔离 PostgreSQL 中实际应用迁移；没有执行阿里云生产迁移，也没有修改用户的 `.env` 或密钥。

本机 Mock 预览已启动于 <http://127.0.0.1:3100>，健康检查返回 200，预览数据库也已应用新增迁移。进程仅本机监听，使用进程级草稿开关；预览日志位于 `.data/knowledge-preview.stdout.log` 和 `.data/knowledge-preview.stderr.log`。可自行注册，或使用项目既有演示账号登录。

开发验证草稿：

```powershell
pnpm exec cross-env ALLOW_DRAFT_KNOWLEDGE=true pnpm preview
```

## 5. 仍未完成与后续优先级

| 项目 | 当前缺口 | 下一步 |
|---|---|---|
| 真正可执行 Question Graph | success_condition、evidenceRule 和 SUCCESS/PARTIAL/FAIL 等条件分支未接入 | 教师确定每目标必要证据与反证，再实现服务端规则求值 |
| 完整 LearnerStateV2 | 缺 unitStates、误解确认/修复状态、独立 verificationCount、证据可靠性因素 | 结合 Assess 结构化输出和真实 message ID 实现，不使用文本流畅度代替掌握证据 |
| 诊断聚合 | 未实现 L1～L4 聚合与平行题独立验证 | 先用教师确认样例校准 |
| REFLECTION | 无独立定向修订提交、修订后评价流程 | 在 FEYNMAN runtime 下实现真实活动，不只添加枚举或进度条 |
| 七阶段 HTML 进度 | 现有页面仍显示 runtime 阶段 | 待活动闭环实现后统一页面状态，当前 CASE_TRANSFER 作为实际消息活动可用 |
| Golden Set 教学验收 | 20 条仅验证“已提供候选标签 → 服务端路由” | 补教师签认的回答 → 证据/标签/等级/分数样例及真实模型回归 |
| 报告证据充分性 | 只链接可核查直接引文，尚不判定语义概括是否可靠 | 证据提取、存在性检查、每维锚点规则及 HTML 证据回溯 |
| 发布管理 | 无教师在线 diff/review/publish/archive 页面 | 按文档 P2，在需要在线编辑时再引入 release 表和受权限控制的完整页面 |
| 历史版本内容归档 | 保存 hash/版本标识，不保存每个发布包的完整不可变副本 | 增加不可变发布归档与回滚，不把旧报告强行绑定当前内容 |
| 多课程/知识点 | 现有应用支持多课程，但 curated manifest 仍只有系统性风险这一知识点 | 增加经审核内容及明确课程绑定，不能把 8 个案例说成 8 个知识点 |
| 全局曝光统计 | 同会话及同版本再练链可去重，独立新会话不共享曝光 | 有必要时增加用户级资源曝光记录 |
| FTS/pgvector | 仍未实现 | 按文档建议继续后置；小型 curated 图不应依赖向量检索做教学决策 |

## 6. 检测记录

| 检查 | 结果 |
|---|---|
| `pnpm knowledge:validate` | 通过：1 manifest、13 KU、9 标签、45 题、8 案例；另含 10 题组 |
| `pnpm knowledge:test` | 通过：12 条知识与运行安全测试 |
| `pnpm knowledge:golden` | 通过：20 条待教师确认的工程路由样例 |
| `pnpm knowledge:workflow` | 通过：6 条会话集成测试，含完整 curated 路径 |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm test` | 通过：104 条通过、2 条原配置跳过 |
| 原核心闭环 Playwright | 桌面 1440×900、手机 375×812，2 条通过 |
| curated 知识库 Playwright | 桌面和手机均走通诊断、追问、案例、费曼、报告与刷新恢复，2 条通过；检查无横向溢出并保存截图 |
| `pnpm build` | 通过：Next.js 生产构建完成，47 个静态页面生成 |

浏览器使用本机 Chrome，经现有 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 覆盖。curated 浏览器测试显式设置 `ALLOW_DRAFT_KNOWLEDGE=true`，默认环境下不会绕过发布门禁。测试期间曾发现并修复错误 ID 与 category 混用导致的案例排序回归；未安装 Playwright 浏览器、ESM JSON 导入和测试速率限制等环境问题亦已处理。

测试使用 Mock，不验证真实 DeepSeek 教学准确率、提示注入的绝对免疫、教师实际审核或阿里云生产资源。已存在的 pg 客户端并发查询弃用警告仍需后续专项处理。
