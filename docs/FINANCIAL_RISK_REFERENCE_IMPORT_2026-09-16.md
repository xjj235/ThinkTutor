# 五类金融风险知识资料导入

本次将用户指定的五个 `*_8个文档_v1.2.1.zip` 全部导入 ThinkTutor 的内置知识资料库。原始 DOCX、完整提取文本、来源文件名、版本、压缩包/文档/文本 SHA-256 和段落/表格行定位均保留。

| 主题 | 原始文档 | 正文段落/表格行 | 可用于开发学习检索的知识单元 |
| --- | ---: | ---: | ---: |
| 汇率风险 | 8 | 580 | 8 |
| 经济周期风险 | 8 | 580 | 8 |
| 利率风险 | 8 | 580 | 8 |
| 通货膨胀风险 | 8 | 580 | 8 |
| 政策风险 | 8 | 580 | 8 |
| 合计 | 40 | 2,900 | 40 |

## 使用入口

- 教师或管理员：`/teacher/knowledge` → “知识资料库”，或直接访问 `/teacher/knowledge/library`。
- 目录支持五主题筛选和全部 40 份文档的全文检索；点击文档查看完整原文、命中位置和来源校验信息。
- 游客和学生不能访问教师资料库与原文页。资料没有放入 `public`。
- 学习上下文复用现有课程学习/自主学习链路。开发或测试环境显式启用 `ALLOW_DRAFT_KNOWLEDGE=true` 时，五类主题的学科知识正文可以检索，最多 3 条，遵守总条数和字符预算。本地预览可使用 `PREVIEW_ALLOW_DRAFT_KNOWLEDGE=true` 启动现有 `pnpm preview`。
- 已固定结构化知识发布版本的会话不混入这些草稿资料；学生答复不能改变检索主题。生产环境保持原有草稿禁用规则。

## 导入边界和来源问题

40 份文档全部作为参考资料保存并索引。源文档标注为 `draft`，本次未虚构教师审核、模型校准或生产发布记录。

学习检索只使用每主题 01 文档的八个 Knowledge Unit 的名称与核心内容，不使用掌握标准列。02–08 的教学流程、诊断题、Question Graph、案例、评价规则和 Prompt 全文可供教师检索核对；它们不自动成为系统提示词、状态机、评分规则或可执行路由，也不把教师答案直接塞入学生会话。

独立源文档核对发现：每主题 5 个案例，共 25 个，`follow_up_mapping` 的问题组编号与目标知识单元对应组存在错位。例如利率风险 `M_IR_001` 对应 `SQG_IR_003`，源案例却指向 `SQG_IR_002`。汇率案例中还存在折算情境与对冲目标不一致，多个问题组机械复用第 4 项误解作为触发条件。原文保持不变，供教师复核；这些映射没有作为运行规则执行。案例均为教学构造案例，不能当作已证实的真实事件。

## 文件与复现

- 数据与原件：`knowledge/courses/financial-risk-management/reference-library/`。
- 导入脚本：`scripts/import-risk-reference-documents.py`。仅处理指定五包，每包必须为 01–08 共八份 DOCX；检查 ZIP 路径、展开大小与完整性，全部验证后写入，拒绝覆盖内容不同的既有文件。
- 数据 schema 与知识正文映射：`src/lib/knowledge/reference-library.ts`。
- 检索器：`src/lib/retrieval/reference-retriever.ts`，经 `src/lib/ai/context-builder.ts` 接入既有 AI 上下文，不添加新的模型或后端服务。

```powershell
python scripts/import-risk-reference-documents.py --source-dir 'D:\桌面'
```

测试使用 Mock 和独立临时 PostgreSQL，未执行真实模型调用或修改业务数据库。`tests/unit/reference-library.test.ts` 使用 mammoth 独立抽取全部 DOCX，与 JSON 正文逐字比对（仅规范化空白与表格分隔符），并验证来源校验和、主题隔离、权限相关上下文边界和生产门禁；集成测试覆盖课程/自主学习接入及预算；浏览器测试覆盖全文查阅与角色权限。

本机 pnpm 11 运行前会尝试自动重装依赖。本轮执行检查时使用进程级 `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false` 保留现有依赖，不修改依赖文件或锁文件。

## 本轮验证结果（2026-09-16）

- `pnpm lint`：通过。
- `pnpm test`：40 个测试文件通过，1 个跳过；446 项通过、3 项跳过。新增资料库单元测试 35 项、上下文集成测试 16 项均通过。
- `pnpm build`：通过；新资料目录和原文页均进入 Next.js 构建。
- `pnpm e2e e2e/thinktutor-flow.spec.ts e2e/knowledge-library.spec.ts`：8/8 通过，含 1440px 桌面和 375×812 手机；覆盖教师全文检索、来源查看、管理员访问、游客/学生拒绝，以及原有完整学习闭环。资料页无横向溢出。
- 40/40 DOCX 的独立抽取全文比对、原件 SHA-256 与正文 SHA-256 均通过。
- `git diff --check`：通过。保留任务开始时的全部未提交修改，仅去除本轮浏览器测试自动加入的临时 TypeScript 路径。

以上是本轮实际运行证据；不代表源文档已通过教师学科审核、真实模型校准或生产发布。
