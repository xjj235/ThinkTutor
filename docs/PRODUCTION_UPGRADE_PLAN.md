# ThinkTutor 生产级升级计划

> 创建日期：2026-08-09
> 执行原则：增量迁移、每阶段验证、保留既有学习闭环、失败可回滚。

## 1. 当前基线

### 1.1 已有能力

- Next.js 16 App Router、React 19、TypeScript strict、Tailwind CSS 4。
- Prisma 7 + SQLite，包含 `LearningSession`、`Message`、`LearningReport`。
- Mock/OpenAI Provider、Zod 结构化输出、基础幂等控制。
- 诊断 → 苏格拉底追问 → 费曼讲解 → 报告 → 再练一轮。
- 4 个中文用户页面、MVP API、Vitest 与 Playwright 测试。

### 1.2 基线验证

- `pnpm lint`：通过。
- `pnpm test`：11 个测试文件、52 个测试全部通过。
- `pnpm build`：通过。
- `dev.db`：1 个学习会话、1 条消息、0 份报告；不存在用户表。

### 1.3 主要缺口

- 无注册、登录、会话管理、RBAC 和资源级授权。
- 无课程、章节、学习目标、班级、选课、任务等正式业务模型。
- 生产数据库仍为 SQLite；没有 PostgreSQL 迁移与旧数据导入流程。
- AI 仍包含 OpenAI Provider，未实现 DeepSeek V4 Flash、上下文预算和使用审计。
- 报告维度、漏洞、优势、下一步仍存于 JSON，无法可靠检索和分析。
- 无对象存储、材料解析、后台 Worker、课程资料检索。
- 无学生/教师/管理员工作台、生产限流、分布式锁和可观测性。
- 无 Docker、Nginx、CI、阿里云部署与运维文件。

## 2. 目标架构

```text
Browser
  -> Nginx / HTTPS
  -> Next.js (public pages + authenticated app + route handlers)
      -> PostgreSQL (Prisma)
      -> Redis/Tair (rate limit, lock, BullMQ)
      -> OSS (private course materials)
      -> DeepSeek Chat Completions (server only)
  -> Worker (material parsing, chunking, indexing)
```

关键边界：

- 浏览器不接触数据库、DeepSeek Key 或 OSS 长期凭证。
- 所有资源读写执行身份认证、角色校验和资源级授权。
- 学习阶段只能由服务端纯状态机推进；AI 只能提出建议。
- AI 调用失败、输出无效或并发冲突时，不推进阶段、不增加有效轮数。
- 生产只允许 PostgreSQL、Redis/Tair、OSS 和 `deepseek-v4-flash`。

## 3. 数据迁移策略

1. 原样备份 `dev.db`、Prisma 配置、依赖锁文件和关键文档。
2. 通过只读脚本导出旧 SQLite 的会话、消息和报告为版本化 JSON。
3. 新建 PostgreSQL schema 与迁移，不修改或删除旧 SQLite 文件。
4. 将旧数据归属到明确的 legacy 用户；导入使用稳定旧 ID，保证关联不变。
5. 导入前后校验表级数量、外键、消息顺序、报告分数和重试父子关系。
6. 导入脚本默认 dry-run；只有显式确认参数才写入目标数据库。
7. 失败时清理本次导入批次，不影响旧 SQLite 备份。

## 4. 分阶段执行

### Phase 0 — 仓库审查

- 完整盘点源码、API、页面、测试、依赖、环境变量、数据库和 Git 状态。
- 记录 SQLite 数据量和现有基线命令结果。
- 验收：基线 lint/test/build 可复现，缺口与风险已记录。

### Phase 1 — 升级计划和备份

- 创建本文档和带时间戳的本地备份目录。
- 备份 SQLite、Prisma、依赖、环境模板和现有 Git diff。
- 创建 legacy SQLite 导出脚本并保存校验摘要。
- 验收：备份可读、校验和可核对、原数据库未改变。

### Phase 2 — 依赖整理

- 移除生产 OpenAI/LibSQL 依赖，增加 PostgreSQL、密码哈希、会话、Redis、队列、OSS、解析和安全 Markdown 所需依赖。
- 统一 Node/ESM/Prisma 7 配置，继续使用 pnpm 锁定。
- 验收：冻结安装、Prisma generate、lint/test 通过。

### Phase 3 — SQLite 到 PostgreSQL

- 将 Prisma datasource 改为 PostgreSQL，建立生产级模型、约束、索引和迁移。
- 提供 Docker PostgreSQL 开发/测试环境、legacy export/import 和数量校验。
- 验收：全新库 migrate/seed 成功；旧数据导出成功；导入具备 dry-run 和幂等保护。

### Phase 4 — 用户认证与 RBAC

- 实现数据库会话认证、Argon2id 密码、CSRF/同源保护、注册/登录/退出。
- 角色为 STUDENT/TEACHER/ADMIN；公开注册只能创建 STUDENT。
- 实现服务端角色与资源级授权、管理员 CLI、审计日志。
- 验收：认证、越权、IDOR、会话撤销测试通过。

### Phase 5 — Course / Chapter / LearningGoal

- 实现课程、章节、学习目标及教师所有权。
- 教师可管理自己的课程，管理员可全局管理，学生只能读获授权内容。
- 验收：CRUD、顺序、归属和越权测试通过。

### Phase 6 — Classroom / Enrollment / Assignment

- 实现班级、邀请码/成员关系、任务发布与学生任务状态。
- 任务与课程目标、学习会话建立可追溯关联。
- 验收：教师发布、学生加入/查看、跨班越权测试通过。

### Phase 7 — DeepSeek Provider

- 以官方 OpenAI-compatible Chat Completions 接口接入 `deepseek-v4-flash`。
- 实现 JSON Output、Zod/领域二次验证、最多两次退避重试、错误分类、匿名 user_id、thinking 策略和 AIUsage。
- 生产配置若不是指定模型则启动失败；mock 不受影响。
- 验收：Provider 单测覆盖成功、空输出、无效 JSON、401、429、5xx、超时和网络错误。

### Phase 8 — 核心学习状态机

- 增加 REPORTING/ABANDONED；建议 4–6 轮、最少 3、最多 8。
- 进入费曼前校验有效轮次、题型覆盖、概念/因果/证据和 LearnerState 证据。
- 实现四级支架与集中式上下文构建器；并发更新使用事务和版本/锁。
- 验收：转换矩阵、边界轮次、AI 失败和并发测试通过。

### Phase 9 — 报告数据规范化

- 将维度、漏洞、优势和下一步规范化到独立表。
- overallScore 继续由服务端五维平均计算；每项证据必填。
- retry 绑定最高优先级 OPEN 漏洞和 `sourceGapId`。
- 验收：报告事务一致性、分数、漏洞状态和再练关联测试通过。

### Phase 10 — OSS / StorageProvider

- 定义 StorageProvider；Local 仅开发/测试，Aliyun OSS 用于生产。
- 私有 Bucket、随机对象键、白名单、服务端 head 二次校验和短时签名 URL。
- 验收：路径穿越、伪造 MIME、超限、未授权下载测试通过。

### Phase 11 — Material Worker

- 建立材料状态机和 BullMQ Worker。
- 支持 PDF、DOCX、TXT、MD；PPTX 只有解析链可靠时才启用。
- 解析、清洗、分块、重试、失败原因和审计均持久化。
- 验收：状态转换、重复任务、失败重试和解析测试通过。

### Phase 12 — Course Retrieval

- 实现 PostgreSQL 词法检索与可选 `pg_trgm`/GIN 索引降级路径。
- 上下文只注入授权课程的相关 MaterialChunk，并受 token/字符预算约束。
- 验收：相关性、课程隔离、无扩展降级和预算测试通过。

### Phase 13 — 学生端

- 公共首页/about/privacy/terms，注册登录，学生 dashboard、任务、会话、报告、历史和档案。
- 刷新恢复、空/错/重试状态、375px 与键盘操作完整。
- 验收：学生闭环 E2E 和移动端浏览器检查通过。

### Phase 14 — 教师端

- 教师 dashboard、课程/章节/目标、材料、班级、任务、学习分析和报告查看。
- 不呈现标准化测评或人格判断。
- 验收：教师课程到分析闭环 E2E、权限与移动端检查通过。

### Phase 15 — 管理员端

- 用户、角色、系统状态、AI 使用和审计日志的最小必要后台。
- 高风险操作要求明确确认并记录 AuditLog。
- 验收：管理员授权、不可自助提权和审计测试通过。

### Phase 16 — Tair / 限流 / 队列

- 抽象 Redis Provider，生产强制 Tair/Redis，开发可使用 Docker Redis。
- 对登录、注册、AI、上传和高成本查询设置用户/IP 组合限流。
- 学习提交和 Worker 使用分布式锁/幂等键。
- 验收：限流窗口、锁释放、故障降级和重复任务测试通过。

### Phase 17 — 可观测性

- 结构化日志、requestId、live/ready health、AIUsage、AuditLog 和隐私脱敏。
- 日志不包含密码、密钥、Token、完整学生输入或隐藏推理。
- 验收：健康检查、错误关联、敏感信息扫描测试通过。

### Phase 18 — Docker / Nginx / 阿里云

- 多阶段 Dockerfile、dev/prod compose、Nginx、部署/迁移/回滚/备份脚本、CI。
- 文档化 ECS、RDS、Tair、OSS、域名、HTTPS、安全组与中国内地备案注意事项。
- 验收：本地 compose 构建启动、迁移、健康检查和脚本 dry-run 通过。

### Phase 19 — 全量测试

- 单元、集成、权限、安全、Provider、Worker、迁移与 Playwright 全闭环。
- 桌面 1440px 和移动 375px 实测；DeepSeek live smoke 仅在显式环境开关和真实 Key 下运行。
- 验收：不删除测试、不降低断言，所有可执行测试通过。

### Phase 20 — 生产工程审查

- 审查 diff、Secrets、`any`、ts-ignore、TODO/FIXME、console、硬编码、旧模型/Provider、SQLite 生产遗留、权限/IDOR/路径、迁移、Docker、文档和测试。
- 生成 `docs/FINAL_PRODUCTION_REVIEW.md` 和未勾选的人工上线清单。
- 验收：冻结安装、generate、PostgreSQL migration test、lint/test/build/e2e 全部通过；无法验证的真实云资源明确列为未完成。

## 5. 测试门禁

- 每个后端阶段至少运行 `pnpm lint`、`pnpm test`。
- 每个 UI/核心流程阶段额外运行 `pnpm e2e`。
- 最终运行冻结安装、Prisma generate、全新 PostgreSQL migration/seed、lint、test、build、e2e。
- DeepSeek 真实调用、RDS、Tair、OSS、域名和证书只在真实凭据/资源存在时验证；否则不得宣称完成。

## 6. 回滚与数据保护

- 不删除 `dev.db`，不覆盖任何备份。
- 每次迁移先导出、后写入；导入批次带唯一标识并可按批次回滚。
- schema 变更使用向前迁移；破坏性变更拆成“新增—回填—切换—清理”多个版本。
- 应用发布采用先迁移兼容 schema、再滚动发布应用；回滚时保留向后兼容字段。
- OSS 对象删除默认软删除/延迟清理；数据库级删除按所有权和审计策略执行。

## 7. 已知外部依赖

- 真实 DeepSeek Smoke 需要 `DEEPSEEK_API_KEY`。
- 生产验收需要可访问的 RDS PostgreSQL、Tair Redis、私有 OSS Bucket、ECS、域名和证书。
- 中国内地公网部署可能需要 ICP 备案及相应合规手续。
- 本地没有这些真实资源时，只能完成实现、自动化测试、容器化和 dry-run，不能宣称云端上线完成。
