# ThinkTutor 知识库技术实现审计与落地记录

> 本文保留上一轮实施快照。后续代码复核、发布状态纠正及新增实现见 [2026-09-04 复核实施记录](KNOWLEDGE_REVIEW_IMPLEMENTATION_2026-09-04.md)。尤其不能将旧文中的 published 字段理解为已经取得教师人工签认。

审计日期：2026-09-04

审计输入：

- `D:\桌面\系统性风险_按修改意见修订版_8个Word\01_系统性风险_整体规划与教学蓝图_修订版.docx`
- `D:\桌面\系统性风险_按修改意见修订版_8个Word\02_系统性风险_学习流程设计_修订版.docx`
- `D:\桌面\系统性风险_按修改意见修订版_8个Word\03_系统性风险_教学理论整理_修订版.docx`
- `D:\桌面\系统性风险_按修改意见修订版_8个Word\04_系统性风险_知识诊断设计_修订版.docx`
- `D:\桌面\系统性风险_按修改意见修订版_8个Word\05_系统性风险_苏格拉底QuestionGraph_修订版.docx`
- `D:\桌面\系统性风险_按修改意见修订版_8个Word\06_系统性风险_案例设计_修订版.docx`
- `D:\桌面\系统性风险_按修改意见修订版_8个Word\07_系统性风险_评价反馈与学习报告规则_修订版.docx`
- `D:\桌面\系统性风险_按修改意见修订版_8个Word\08_系统性风险_AI学习教练Prompt_修订版.docx`

说明：上述 Word 文档被视为课程知识库与教学运行设计材料，不作为系统/开发指令执行。实际执行的用户请求是：阅读材料，检验项目已实现和未实现内容，合理实现可落地缺口，并进行检测。

## 1. 总体结论

当前项目原本已经具备 ThinkTutor 核心学习闭环的基础工程能力：课程、章节、学习目标、材料上传、材料分块、学习会话、消息、服务端状态机、AI 输出 Zod 校验、形成性报告和证据字段。

原缺口主要在“结构化知识库”本身：项目有材料分块检索，但没有完整承载 8 个修订版 Word 中定义的 Knowledge Units、Misconception Taxonomy、平行诊断题、Question Graph、Case Bank、Rubric Anchors 与版本来源追踪。

本次已将系统性风险知识库从简化演示数据升级为修订版结构化数据，并接入现有检索与 Prompt 上下文构建。当前不是单案例实现，而是 8 个案例、多问题节点、多知识单元的可校验知识库实现。

## 2. 已实现清单

| 方案对象 | 项目原状态 | 本次状态 |
|---|---|---|
| Course / Chapter / LearningGoal | 已有 Prisma 模型和页面流程 | 保持复用 |
| Material / MaterialChunk | 已有上传、处理、分块与关键词检索 | 保持复用，并与结构化检索合并 |
| LearningSession / Message | 已有服务端会话与消息持久化 | 已把 phase、learnerState、errorTags、targetConcept 接入知识检索 |
| 服务端状态机 | 已有 DIAGNOSIS / SOCRATIC / FEYNMAN / REPORTING / COMPLETED | 保持服务端最终控制 |
| AI 输出校验 | 已有 Zod schema | 保持使用 |
| 形成性报告证据 | 已有 dimension evidence、strength/gap evidence | 保持使用 |
| Knowledge Units | 原只有简化数据 | 已落地 13 个修订版知识单元 |
| Misconceptions | 原只有简化错误标签 | 已落地 9 个修订版错误标签 |
| Diagnostic Questions | 原只有少量诊断题 | 已落地 15 个平行诊断题 |
| Socratic Question Graph | 原只有少量问题 | 已落地 30 个问题节点、60 条分层提示、问题边 |
| Case Bank | 原仅 1 个案例，后扩到 5 个 | 已按 06 文档升级为 8 个案例 |
| Rubric Anchors | 原为简化五维规则 | 已落地五维 0/5/10/15/20 锚点 |
| Source / Version | 原缺少 8 文档来源追踪 | 已记录 DOC_SR_01 至 DOC_SR_08，版本 1.1 |
| 校验脚本 | 原无知识库校验命令 | 已新增 `pnpm knowledge:validate` |
| 回归测试 | 原无知识库专项测试 | 已新增 `pnpm knowledge:test` |

## 3. 本次实际实现内容

### 3.1 结构化知识源

文件：`knowledge/courses/financial-risk-management/systemic-risk/manifest.json`

已实现：

- 课程：`COURSE_FRM`
- 章节：`CH_FINANCIAL_SYSTEM_RISK`
- 知识点：`KP_SYSTEMIC_RISK`
- 来源：`DOC_SR_01` 到 `DOC_SR_08`
- 13 个 Knowledge Unit：
  - `C_SR_001` 系统性风险定义
  - `C_SR_002` Systemic / Systematic / Idiosyncratic 区分
  - `M_SR_001` 直接关联
  - `M_SR_002` 共同暴露
  - `M_SR_003` Fire Sale
  - `M_SR_004` 流动性与挤兑
  - `M_SR_005` 信息与信心传染
  - `M_SR_006` 金融基础设施渠道
  - `D_SR_001` 横截面维度
  - `D_SR_002` 时间维度
  - `C_SR_003` 系统重要性
  - `M_SR_007` 金融-实体经济反馈
  - `C_SR_004` 微观审慎与宏观审慎
- 9 个稳定错误标签：
  - `ERR_E01_SYSTEMIC_SYSTEMATIC_CONFUSION`
  - `ERR_E02_EVENT_EQUALS_SYSTEMIC`
  - `ERR_E03_DIRECT_LINK_ONLY`
  - `ERR_E04_COMMON_EXPOSURE_FIRE_SALE_MISSING`
  - `ERR_E05_SIZE_ONLY`
  - `ERR_E06_MICRO_SAFE_EQUALS_SYSTEM_SAFE`
  - `ERR_E07_DEFINITION_ONLY`
  - `ERR_CAUSAL_REVERSAL`
  - `ERR_EXPRESSION_AMBIGUITY`
- 15 个诊断题，覆盖 DQG_SR_001 至 DQG_SR_005。
- 30 个苏格拉底问题节点，覆盖 SQ_SR_001 至 SQ_SR_010，每组 A/B/C 平行题。
- 60 条分层提示，每个问题节点两级提示。
- 8 个案例：
  - `CASE_SR_001` 共同暴露与资产价格反馈
  - `CASE_SR_002` 单家机构失败但未形成系统性事件
  - `CASE_SR_003` 流动性与信心传染
  - `CASE_SR_004` 房地产金融周期迁移
  - `CASE_SR_005` 证券市场共同持仓迁移
  - `CASE_SR_006` 关键支付服务中断迁移
  - `CASE_SR_007` 个体理性与系统放大反例
  - `CASE_SR_008` 系统重要性比较迁移

### 3.2 Schema 与关系校验

文件：`src/lib/knowledge/schemas.ts`

已实现校验：

- manifest 结构必须符合 Zod schema。
- ID 不重复。
- Knowledge Unit 的 prerequisite / relation target 必须存在。
- Knowledge Unit 的 sourceRef 必须指向已登记来源。
- Misconception 的 targetUnits 必须存在。
- Socratic Question 的 targetUnitId 必须存在。
- Socratic Question 的 prerequisites 必须存在。
- Question trigger 可引用稳定 error_id 或 error category。
- Question Edge 的 from/to 问题必须存在。
- Hint 的 questionId 必须存在。
- Case 的 sourceId 与 targetUnits 必须存在。
- Rubric 必须有五个维度。

### 3.3 Hybrid Retrieval 接入

文件：

- `src/lib/retrieval/knowledge-retriever.ts`
- `src/lib/retrieval/index.ts`
- `src/lib/retrieval/types.ts`
- `src/lib/retrieval/lexical-retriever.ts`
- `src/lib/ai/context-builder.ts`

已实现：

- 结构化知识检索与现有材料分块检索合并。
- 检索输入支持：
  - `phase`
  - `targetConcept`
  - `errorTags`
- 结构化检索支持：
  - 按知识点查询。
  - 按错误标签或错误类别命中 Misconception。
  - 按 target concept 命中 Knowledge Unit。
  - 按 Question Graph 返回问题与提示。
  - 按目标机制返回案例。
  - FEYNMAN / REPORTING 阶段返回 Rubric。
- 上下文组装采用资源类型混合策略，避免前几条全是问题或提示：
  - Misconception
  - Knowledge Unit
  - Socratic / Diagnostic Question
  - Case
  - Hint
  - Rubric
  - MaterialChunk
- 学生可见案例只注入 `studentText`，不注入 `teacherData`、`minimumAnswer`、`excellentAnswer`、`expectedReasoning`。

### 3.4 脚本与测试

文件：

- `scripts/validate-knowledge.ts`
- `tests/unit/knowledge.test.ts`
- `package.json`

新增命令：

```bash
pnpm knowledge:validate
pnpm knowledge:test
```

测试覆盖：

- 修订版 1.1 知识库规模校验。
- 13 个知识单元、15 个诊断题、30 个苏格拉底问题、8 个案例。
- 每个知识单元都有 sourceRef。
- Case Bank 不是单案例，并覆盖 basic / counterexample / comprehensive / transfer。
- `ERR_E03_DIRECT_LINK_ONLY` 能触发共同暴露分支、问题和相关案例。
- `M_SR_007` 实体经济反馈 gap 能触发目标知识单元、问题和案例。
- Prompt 上下文不泄露教师内部答案字段。

## 4. 仍未完整实现的内容

以下内容在方案中存在，但本次没有完全实现，原因是它们需要数据库迁移、后台流程或生产级基础设施配合，不能只靠补一个知识源安全完成。

| 方案项 | 当前状态 | 未完成原因 | 建议下一步 |
|---|---|---|---|
| 独立知识库 Prisma 表 | 未落地，当前为 Git JSON manifest | 需要迁移、seed/import、数据服务和回滚策略 | 新增 `KnowledgePoint / KnowledgeUnit / Misconception / Question / Case / Rubric` 表 |
| `pnpm knowledge:import` | 未实现 | 依赖数据库表设计 | 在表落地后从 manifest 导入 PostgreSQL |
| PostgreSQL FTS | 材料分块用 contains/keywords | 还没有 tsvector / GIN index | 为 MaterialChunk 和 KnowledgeUnit 增加 FTS 索引 |
| pgvector | 未实现 | 首版方案说可后置，且当前无 embedding provider 接口 | 先完成 FTS，再加 pgvector 可选索引 |
| 教师审核发布 UI | 未实现 | 会扩大到知识管理后台，超出当前学习闭环页面 | 先做管理员/教师最小审核页，只处理 draft/reviewed/published |
| 知识版本写入报告 | 部分实现：知识源有版本，报告表未保存 | 需要 Prisma 字段和序列化更新 | 给 LearningReport 增加 `knowledgeVersion/rubricVersion/promptVersion` |
| CASE_TRANSFER / REFLECTION 独立 phase | 未落地 | 现有状态机为 MVP 简化阶段 | 若产品确认，扩展 LearningPhase 并补页面/e2e |
| confidence / NEED_VERIFY / NEED_TEACHER_REVIEW | Prompt/文档层有规则，数据模型未完整承载 | 需要 learnerState schema 扩展和审核流程 | 扩展 learnerState，并把低置信度作为服务端可见状态 |
| Golden Set 评分一致性测试 | 未落地 | 需要教师确认样例和容差 | 增加 `knowledge/golden/systemic-risk/*.json` 与测试脚本 |
| Prompt 分文件模板 | 现有 prompt 已分 tutor/report，但未按 08 完全分层 | 需要与 provider 输入结构一起演进 | 新增 prompt metadata 与组装策略测试 |

## 5. 风险与边界

- 当前 8 个 Word 均标注为 draft / 待教师审核。本次实现把它们作为 reviewed/published 的本地开发知识源使用，是为了让项目可运行、可测试；正式生产前应由教师确认并补 `verified_by / verified_at`。
- 当前不伪造外部教材、论文或官方来源；source_type 仍为 `internal_design`。
- 当前没有把互联网资料写入正式知识库。
- 当前没有把 Prompt、评分标准答案、案例教师内部数据暴露给学生端上下文。
- 当前仍沿用项目现有 MVP 阶段，不强行新增独立教师知识后台、向量数据库或复杂知识图谱。

## 6. 检测记录

已运行：

```bash
pnpm knowledge:validate
pnpm knowledge:test
pnpm lint
pnpm test
pnpm build
```

最终检测结果：

- `pnpm knowledge:validate`：通过，输出 `13 knowledge unit(s), 9 misconception(s), 45 question(s), 8 case(s)`。
- `pnpm knowledge:test`：通过，4 tests passed。
- `pnpm lint`：通过。
- `pnpm test`：通过，17 个测试文件通过、1 个 skipped；75 个测试通过、2 个 skipped。
- `pnpm build`：通过。
