# ThinkTutor 系统性风险 v1.2.1 实施与验证

日期：2026-09-06\
项目：D:\Codex\New project\
实施依据：用户提供的《文档2_v1.2技术完全实现方案_2026-09-05.md》及 2026-09-05 八文档复核。

## 结论

本轮已实施主要工程工作包并重新验证，保留已有未提交修改、v1.1 资源及浅色专业工作台。
KR_SR_1_2 仍为草稿，不代表教师已签署或生产已发布。
文档条款作为实现和验收依据，没有用工程夹具伪造教师来源、校准样例或发布记录。

## 工作包对应

| 工作包 | 本轮实现 | 主要代码 |
|---|---|---|
| WP0 | 统一 v1.2.1 资源与严格 Schema；跨资源检查关系规则、来源、18条唯一教学规则 | src/lib/knowledge/v12-schema.ts、schemas.ts |
| WP1 | 所有诊断退出均要求稳定证据；连续低置信度、矛盾、题库耗尽不能直接推进 | v12-engine.ts |
| WP2 | REL_SR_003 独立执行共同资产损失、去杠杆/集中出售、向火售反馈转化三项证据；删除 M_SR_003 默认回退 | v12-resources.ts、v12-engine.ts |
| WP3 | 八案例完整证据、逐 critical step 缺失、低置信度、矛盾、已见/未见及耗尽矩阵；API 逐步骤成功/修复 | tests/unit/v12-case-matrix.test.ts、tests/integration/v12-case-flow.test.ts |
| WP4 | 新建和再练先呈现目标、预计用时和确认按钮；服务端拒绝绕过确认；保存呈现/确认时间 | session-service.ts、v12-session-service.ts、session-client.tsx |
| WP5 | 纯状态机保存阶段变更原因、原文引用、执行者类型及时间；报告可展开阶段依据 | state-machine.ts、report-client.tsx |
| WP6 | 显式恢复核验；超过30分钟且已有学习证据时要求先核验；低置信度保留核验，成功恢复，失败记录缺口并降级目标 | v12-session-service.ts、state-machine.ts |
| WP7 | 18条规则具有300/200/100优先级、作用范围、结构化触发/条件/效果、依据类型、版本及来源审核字段；真实性核验可阻断推进 | pedagogy.ts、v12-schema.ts |
| WP8 | candidate gap、misconception、证据 flags 均可通过教师页面复核；重算待审核状态时覆盖全部类型 | review-service.ts、teacher/knowledge/claims/page.tsx |
| WP9 | 更新八份带(1)的来源文件定位；分离内容、教学、评价来源映射；教师页面展示位置、哈希及核验记录 | v12-resources.ts、teacher/knowledge/page.tsx |
| WP10 | 先合并最终来源并冻结，再运行模型校准；发布检查 release ID、内容/样例 hash、目标模型、Prompt 与完整样例结果；发布签署不改变内容 hash | release-candidate.ts、review-service.ts、releases.ts |
| WP11 | 教师表单支持缺口、消解/未消解判断、五维锚点与六类验证场景；冻结要求20–50条不重复样例并覆盖等级/错误/关键缺口 | review-schemas.ts、knowledge-review-forms.tsx |
| WP12 | 外部 TurnAssessment 仅保留六类候选证据字段；TutorResponse 仅 assistantMessage；服务端派生聚合置信度，拒绝阶段/分数/delta字段 | v12-schema.ts、assessment-v12.ts、deepseek-provider.ts |
| WP13 | 采用方案允许的“删除未接入合同”选项：v1.2评估只使用固定版本知识资源，不承诺注入课程材料 chunks；原有通用课程检索保留 | context-budget.ts、retrieval/index.ts |
| WP14 | 默认 pnpm e2e 自动分开通用和v1.2运行模式，串行共享审核夹具；动态端口同步APP_URL，构建缓存隔离 | scripts/run-e2e.ts、playwright.config.ts |
| WP15 | 持久化 finalClaims，覆盖错误/缺口、状态、引用及置信度；最终可靠证据可消解缺口；优势和缺口引用真实原文 | v12-report.ts |
| WP16 | 八案例均在桌面和375px移动端完成成功、修复、新情境、费曼、反思、报告与原文展开 | e2e/v12-case-matrix.spec.ts |
| WP17 | 正式发布门禁及冻结数据库约束已实现；正式内容核验、全量真实模型校准与签署尚未完成 | review-service.ts、20260906000100_knowledge_release_freeze/migration.sql |

## 本轮验证

以下均为本轮实测，不引用历史测试结果。

| 检查 | 最终结果 |
|---|---|
| pnpm knowledge:validate | 通过；v1.1与v1.2合计2个manifest、26 KU、93题、16案例 |
| pnpm lint | 通过 |
| pnpm test | 26个测试文件通过、1个live文件默认跳过；251项通过、3项跳过 |
| pnpm build | 通过；包括新增 /api/sessions/[id]/events |
| pnpm e2e | 默认流程28项通过，v1.2流程18项通过；合计46项，无需手工加workers参数 |
| 真实 DeepSeek v1.2 smoke | 1项通过，另2项因范围过滤跳过；验证引用与阶段注入边界，不等于教师Golden全量校准 |
| 桌面/移动截图 | 已检查报告和案例修复后的页面；文本与控件未见横向溢出 |
| git diff --check | 保留原有 scripts/local-preview.ts 末尾空行提示；未回退该历史修改 |

v1.2资源规模：13 KU、15诊断题、11 Question Group、33苏格拉底题、66提示、8案例、8关系、3 competency、18教学规则。

测试明确分层：

- 单元/API矩阵使用工程合成证据，证明规则执行、原文校验和事务行为。
- 八案例E2E通过测试数据库设置指定案例和前置状态，没有添加生产选题/掌握绕过接口；不把夹具当作真实学生学习证据。
- 发布事务测试使用合成教师记录和模拟校准结果，只证明冻结/hash/门禁，不证明教学内容准确性。
- 真实模型只执行一条合成回答冒烟。429、超时、非法JSON等异常路径由隔离的provider测试验证，不对真实服务进行压力测试。

## 运行与审核

本轮独立预览：

- 地址：http://127.0.0.1:3102
- 学生：student@example.test；教师：teacher@example.test；管理员：admin@example.test
- 预览专用密码：ThinkTutor-Preview-2026!
- 数据：.local-preview/v121/postgres；数据库端口55437；构建目录.next/v121-preview
- Mock AI，允许开发草稿；不产生模型费用，不是生产配置。

已有旧结构的未冻结草稿，可在教师知识审核页面选择“升级草稿资源并重置规则核验”。
该操作保留已录入的来源和Golden样例，但撤销旧校准与规则核验；不会自动执行，也不能用于已发布版本。

正式审核顺序：

1. 教师核验13 KU来源和18条教学规则的依据及精确位置。
2. 教师录入20–50条真实核验样例，覆盖L1–L4、五类错误、四类关键缺口及六类场景。
3. 确认完整来源并冻结候选；冻结后不能直接编辑，解除冻结会撤销校准。
4. 以生产目标DeepSeek模型运行冻结快照的全部样例，所有结果通过。
5. 教师审核、签署、发布；生产禁止draft override。

## 尚未完成

教师核验的准确章节/页码、教学理论来源、Golden内容及签署仍需任课教师提交。
目前来源引用是明确标注“待教师核验”的工程映射，不能当成已完成逐条学术溯源。
本轮未获得完整教师Golden材料，因此没有执行全量真实模型校准、正式发布或阿里云生产验收。
既有会话和报告不被本轮回写；旧运行hash或Prompt不匹配时会保留历史并要求新建，不静默升级学生状态。
