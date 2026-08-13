# ThinkTutor 生产级升级汇总

> 整理日期：2026-08-12
> 项目目录：`D:\Codex\New project`
> 当前结论：生产级代码、本地 PostgreSQL 验证、Mock AI 完整闭环、生产构建与双视口浏览器验收已通过；真实 DeepSeek 与阿里云资源尚未实机验证，因此不能声明已经生产上线。

## 1. 项目定位与范围

ThinkTutor（问思学伴）是基于苏格拉底追问和费曼讲解的 AI 自主学习系统。当前产品范围保持为：

```text
任务创建
→ 知识诊断
→ 3～8 轮由服务端约束的苏格拉底追问
→ 费曼讲解
→ 五维形成性学习报告
→ 针对最高优先级知识漏洞再练
```

本轮没有加入支付、排行榜、社交、直播、小程序、原生 App、家长端、心理诊断或医学诊断。

## 2. 完成情况

### 2.1 已完成

- Next.js 16、React 19、TypeScript strict、Tailwind CSS 4 与 pnpm 工程化；
- SQLite MVP 到 PostgreSQL/Prisma 7 生产数据架构升级；
- STUDENT、TEACHER、ADMIN 用户体系、数据库会话和 RBAC；
- 课程、章节、学习目标、班级、成员、学习任务及任务发布；
- DeepSeek Provider、确定性 Mock Provider、结构化输出与服务端状态机；
- 规范化五维报告、最高优先级漏洞选择与 retry 父子会话；
- Local/OSS 存储、材料 Worker、词法检索与上下文预算；
- 学生端、教师端、管理员端完整页面与 API；
- 限流、分布式锁、BullMQ、审计日志和 AIUsage；
- Docker、Nginx、CI、部署、备份、健康检查和阿里云文档；
- Vitest、Playwright、生产构建和静态安全扫描。

### 2.2 尚未完成的外部验收

- 真实 DeepSeek API 调用；
- 阿里云 RDS、Tair、private OSS、ECS RAM Role 和 ECS/Nginx 实机验证；
- Docker 镜像在当前机器上的实际构建与启动；
- 域名、DNS、SSL、ICP/公安备案；
- RDS 恢复、生产负载、告警和灾备演练；
- 用户协议、隐私政策及未成年人条款的正式法律审核。

## 3. 最终架构

```text
Browser
  │
  ▼
Nginx / HTTPS
  │
  ▼
Next.js Web + Route Handlers
  ├─ PostgreSQL / Prisma
  ├─ Redis / Tair（限流、锁、BullMQ）
  ├─ private OSS（课程材料）
  └─ DeepSeek V4 Flash（仅服务端调用）

Independent Worker
  └─ 材料读取、解析、清洗、分块、索引与失败重试
```

架构边界：

- 浏览器不接触数据库、DeepSeek Key 或 OSS 长期凭据；
- 所有状态转换由服务端纯函数状态机验证；
- AI 只能提出建议，不能决定阶段转换；
- AI 失败不写入半成品消息、不推进 phase、不增加有效轮数；
- 页面刷新后从 PostgreSQL 恢复，不依赖浏览器内存；
- 生产环境强制 DeepSeek、Redis/Tair、OSS 和高强度 `AUTH_SECRET`。

## 4. DeepSeek V4 Flash

### 4.1 已实现

- `AI_PROVIDER` 支持 `mock` 和 `deepseek`；
- 模型名只从 `DEEPSEEK_MODEL` 读取；
- 生产环境强制模型为 `deepseek-v4-flash`；
- 使用 Chat Completions JSON Output；
- 所有输出经过 Zod 二次校验；
- 支持超时、最多两次指数退避及错误分类；
- 覆盖 401/403、429、5xx、网络异常、超时、空输出、无效 JSON 和 Schema 不匹配；
- 请求用户标识经过不可逆哈希，不发送原始用户 ID；
- 记录模型、操作、Token、耗时、重试次数与错误码；
- 不保存或返回隐藏推理内容；
- 学生输入和参考材料被包装为不可信内容，不能覆盖系统规则。

### 4.2 报告约束

- 五个维度都必须包含分数、证据和反馈；
- 未展示的能力必须明确写明“本次对话未充分展示”；
- 模型不生成 `overallScore`；
- 服务端计算五个维度分数的算术平均值；
- 报告始终附带形成性学习反馈免责声明。

### 4.3 真实 API 状态

当前没有 `DEEPSEEK_API_KEY`。真实 smoke 测试已建立，但按环境开关跳过，没有发送收费请求，也没有伪造真实调用成功结论。

## 5. 数据库与迁移

### 5.1 PostgreSQL 模型

主要模型包括：

- `User`、`AuthSession`；
- `Course`、`Chapter`、`LearningGoal`；
- `Classroom`、`Enrollment`；
- `Assignment`、`AssignmentStudent`；
- `Material`、`MaterialChunk`；
- `LearningSession`、`Message`；
- `LearningReport` 及规范化的维度、优势、漏洞和下一步表；
- `AIUsage`、`AuditLog`。

数据库使用唯一约束、索引、版本字段以及符合资源语义的 `Cascade`、`SetNull` 和 `Restrict`。消息的 `clientRequestId` 提供全局防重复机制，学习更新通过 `ReadCommitted`、版本检查和唯一约束保证一致性。

### 5.2 SQLite 处理

- 旧 SQLite 数据库没有被覆盖或删除；
- 已生成只读导出、数量校验和 legacy 导入脚本；
- 导入默认 dry-run，只有显式参数才写入；
- 旧 SQLite migration 仅作为历史档案；
- 生产 Prisma 配置只使用 PostgreSQL migration 目录。

### 5.3 实际验证

- PostgreSQL baseline migration 已在多次全新临时数据库上成功部署；
- Prisma Client 已实际 generate；
- 开发 seed 已在临时 PostgreSQL 上成功执行；
- 报告级联、父子 retry、消息幂等和规范化关系均有数据库集成测试。

## 6. 用户与权限系统

### 6.1 身份认证

- Argon2id 密码哈希；
- 随机不透明数据库 Session；
- HttpOnly、SameSite Cookie，生产启用 Secure；
- 注册、登录、退出、资料更新、改密和账号删除；
- 修改密码后撤销全部 Session；
- 登录和注册限流；
- 公开注册只能创建学生账号；
- 教师和管理员通过管理员授权或交互式 CLI 创建。

### 6.2 授权与删除保护

- 学生只能访问自己的会话、报告和获授权课程；
- 教师只能管理自己的课程、班级、任务和材料；
- 管理员接口只允许 ADMIN；
- 所有受保护 API 在服务端执行角色、所有权或成员关系检查；
- 管理员不能在个人页面自助删除；
- 教师存在归属课程、班级或任务时不能触发级联删除；
- 禁用用户的数据库 Session 会失效。

### 6.3 审计日志

审计事件覆盖：

- 注册、成功/失败登录、退出、密码变更和账号删除；
- 课程、班级、成员、任务发布；
- 材料上传和删除；
- 会话创建、完成和报告生成；
- 管理员角色和账号状态变更。

失败登录只记录邮箱哈希，不记录密码或完整敏感输入。

## 7. 学习状态机与报告

学习阶段包括：

```text
DIAGNOSIS → SOCRATIC → FEYNMAN → REPORTING → COMPLETED
                                      └──────→ ABANDONED（预留终态）
```

服务端规则：

- 首次有效回答后进入 `SOCRATIC`；
- 至少完成 3 轮有效追问；
- 生产默认建议 4～6 轮，最大允许配置为 8；
- 主动进入费曼前必须满足题型覆盖和概念、因果、证据表现；
- 达到最大轮数后服务端强制进入费曼；
- 每轮只有一个主要问题；
- 提示不增加苏格拉底轮数；
- 费曼提交、报告保存和会话完成在数据库事务中处理；
- retry 选择最高优先级的开放漏洞，设置 `parentSessionId` 与 `sourceGapId`。

## 8. 学生系统

学生端已包含：

- 公共首页、注册、登录、about、privacy、terms；
- 学生 dashboard；
- 自主创建学习任务；
- 班级加入与作业列表；
- 四阶段学习页面；
- 单回答输入、提示、加载、错误和重试状态；
- 费曼大文本框和提交要求；
- 五维报告、证据、反馈、优势、漏洞和下一步；
- 历史记录与长期学习档案；
- 针对最高优先级漏洞再练。

页面支持键盘操作、明确 label、空状态、错误状态、刷新恢复以及 375px 移动布局。

## 9. 教师系统

教师端已包含：

- 教师工作台；
- 课程创建和详情；
- 章节与学习目标管理；
- 课程材料上传和处理状态；
- 班级创建、加入码和成员；
- 学习任务创建、发布和学生分配；
- 班级学习分析；
- 学生进度和学习报告查看。

Playwright 已完成以下真实 Mock 闭环：

```text
教师建课、章节和目标
→ 创建班级
→ 学生注册并加入
→ 教师创建并发布任务
→ 学生完成诊断、追问和费曼
→ 生成报告
→ 教师看到学生报告链接
```

## 10. 管理员系统

管理员端已包含：

- 系统总览；
- 用户、角色和账号状态管理；
- AIUsage 查看；
- 材料失败任务查看；
- 系统健康状态；
- 关键操作审计日志。

管理员无法通过公开注册或普通业务接口自助提权，高风险变更带 `requestId` 审计。

## 11. 文件与课程知识

### 11.1 存储

- `StorageProvider` 支持本地签名存储和 Aliyun OSS；
- 对象键使用用户 ID 分区和随机 UUID，不使用原始文件名；
- 上传 URL 有短有效期；
- 校验扩展名、MIME、声明大小和实际对象 Head；
- 本地存储校验路径越界和签名方法；
- OSS 支持显式 STS/AK、跨账号 AssumeRole 和首选 ECS RAM Role IMDSv2。

### 11.2 材料 Worker

- 支持 PDF、DOCX、TXT、MD；
- 检查 PDF/DOCX 文件签名；
- 执行文本抽取、清洗、确定性分块和关键词生成；
- 记录 `QUEUED`、`PROCESSING`、`READY`、`FAILED` 等状态；
- 保存失败码、失败原因和重试次数；
- 重复完成任务不会产生重复材料块；
- PPTX 当前明确拒绝，并提示先导出为 PDF。

### 11.3 检索

- 按课程和章节隔离检索；
- 只检索 `READY` 且未删除的材料；
- 设置材料块数量和上下文字符预算；
- 当前使用确定性的 PostgreSQL 词法检索；
- 保留未来向量检索的 Provider 扩展点。

## 12. 安全检查

最终静态扫描未发现：

- 显式 `any`；
- `@ts-ignore` 或 `@ts-expect-error`；
- TODO/FIXME；
- `console.*`；
- `NEXT_PUBLIC_*` 中的密钥；
- OpenAI Provider 或 OpenAI SDK；
- 其他硬编码生产模型。

其他安全措施：

- 所有 JSON API 输入经过 Zod；
- 所有普通可写 API 执行同源校验；
- 本地上传下载端点依赖短时 HMAC 签名；
- 日志脱敏密码、Token、Cookie、Authorization、DeepSeek 和 OSS 密钥；
- 不使用 `dangerouslySetInnerHTML`；
- Markdown 禁用原始 HTML；
- private OSS 和最小权限 RAM Role；
- `/health/ready` 检查 PostgreSQL 和 Redis，但不产生收费 AI 调用。

## 13. 测试与验证结果

| 验证项 | 结果 | 证据 |
|---|---:|---|
| `pnpm install --frozen-lockfile` | 通过 | 当次审查使用 pnpm 11.16.0；项目现已统一锁定 pnpm 11.19.0 |
| `pnpm prisma:generate` | 通过 | Prisma Client 7.9.1 成功生成 |
| PostgreSQL migration | 通过 | 全新临时数据库成功应用 baseline migration |
| PostgreSQL seed | 通过 | 教师、学生、课程和任务种子成功创建 |
| `pnpm lint` | 通过 | 0 warning |
| `pnpm typecheck` | 通过 | TypeScript strict 无错误 |
| `pnpm test` | 通过 | 13 个文件、54 项通过，1 项 live smoke 跳过 |
| `pnpm build` | 通过 | Next.js 生产构建成功，47 个动态页面/接口 |
| `pnpm e2e` | 通过 | 14/14 Playwright 测试通过 |
| DeepSeek live | 未验证 | 无真实 API Key，1 项按条件跳过 |

自动执行结果合计：

- Vitest：54 项通过，1 项条件跳过；
- Playwright：14 项通过；
- 总计：68 项通过，1 项真实 DeepSeek smoke 跳过。

Playwright 视口：

- 桌面端：1440×900；
- 移动端：375×812。

覆盖内容包括学生闭环、教师任务闭环、刷新持久化、API 错误重试、AI 失败不推进、重复请求幂等、RBAC/IDOR、禁用账号、标签、横向溢出、OSS 路径/MIME、Worker 失败及检索课程隔离。

## 14. 主要文件

### 14.1 工程与部署

- `AGENTS.md`
- `README.md`
- `.env.example`
- `.env.production.example`
- `package.json`
- `pnpm-lock.yaml`
- `Dockerfile`
- `docker-compose.dev.yml`
- `docker-compose.production.yml`
- `.github/workflows/ci.yml`
- `deploy/nginx/thinktutor.conf.example`
- `deploy/scripts/*`

### 14.2 数据与服务端

- `prisma/schema.prisma`
- `prisma/migrations-postgresql/*`
- `prisma/seed.ts`
- `src/lib/db.ts`
- `src/lib/auth/*`
- `src/lib/permissions/*`
- `src/lib/state-machine.ts`
- `src/lib/session-service.ts`
- `src/lib/ai/*`
- `src/lib/storage/*`
- `src/lib/retrieval/*`
- `src/worker/*`

### 14.3 页面与测试

- `src/app/dashboard/*`
- `src/app/session/[sessionId]/*`
- `src/app/report/[sessionId]/*`
- `src/app/teacher/*`
- `src/app/admin/*`
- `tests/unit/*`
- `tests/integration/*`
- `tests/smoke/deepseek-live.test.ts`
- `e2e/*`

### 14.4 文档

- `docs/PRODUCTION_UPGRADE_PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/AUTHORIZATION.md`
- `docs/AI_BEHAVIOR.md`
- `docs/DEEPSEEK_INTEGRATION.md`
- `docs/MATERIAL_PIPELINE.md`
- `docs/SECURITY.md`
- `docs/PRIVACY_DATA_FLOW.md`
- `docs/OPERATIONS.md`
- `docs/ALIYUN_DEPLOYMENT.md`
- `docs/ACCEPTANCE.md`
- `docs/FINAL_PRODUCTION_REVIEW.md`

## 15. 实际执行过的主要命令

```powershell
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm exec tsx scripts/with-test-postgres.ts -- pnpm prisma:seed
pnpm lint
pnpm typecheck
pnpm test
pnpm test:deepseek:live
pnpm build
pnpm e2e
```

还执行了旧 SQLite 数据盘点和只读导出、PostgreSQL 定向集成测试、教师闭环 Playwright、OSS/Worker/检索测试、依赖警告堆栈定位，以及 Secrets、`any`、TODO、OpenAI、SQLite 运行遗留和 API 校验扫描。

## 16. 本地启动

### 16.1 Mock 模式

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose -f docker-compose.dev.yml up -d
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev
```

另开终端运行材料 Worker：

```powershell
pnpm worker
```

开发 seed 需要在 `.env` 中设置 `DEV_SEED_PASSWORD`。Seed 只允许在 development/test 环境执行。

### 16.2 DeepSeek 模式

在仅服务端可读的 `.env` 中设置：

```dotenv
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=your-server-side-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_TIMEOUT_MS=45000
```

然后执行：

```powershell
pnpm dev
```

真实 smoke 仅在明确提供 Key 和运行开关时执行。

## 17. 生产部署入口

```bash
cp .env.production.example .env.production
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml run --rm --no-deps worker pnpm prisma:migrate
docker compose -f docker-compose.production.yml up -d
```

生产 Compose 只包含 Web 和 Worker。PostgreSQL 与 Redis 必须使用同 VPC 的 RDS/Tair，不应在生产 Compose 中启动。

## 18. 上线前人工操作清单

- [ ] 购买 ECS；
- [ ] 创建 RDS PostgreSQL；
- [ ] 创建 Tair Redis；
- [ ] 创建 private OSS；
- [ ] 创建 DeepSeek API Key；
- [ ] 设置生产环境变量与 Secrets；
- [ ] 创建最小权限 RAM Role；
- [ ] 注册并实名认证域名；
- [ ] 完成适用的 ICP/公安备案；
- [ ] 签发 SSL 证书；
- [ ] 配置 DNS；
- [ ] 通过 CLI 创建首个 ADMIN；
- [ ] 执行真实 DeepSeek smoke；
- [ ] 完成 RDS 备份；
- [ ] 执行 Production Migration；
- [ ] 验证 `/api/health/live` 和 `/api/health/ready`；
- [ ] 验证日志、监控、告警和回滚；
- [ ] 审核用户协议、隐私政策和未成年人条款。

这些项目不能因为代码已经完成而标记为通过。

## 19. 已知限制与风险

1. **真实云环境未验证**：当前结果不能等同于已上线。
2. **DeepSeek 未真实调用**：尚未验证真实账户额度、网络延迟和输出质量。
3. **检索能力**：目前是 PostgreSQL 词法检索，尚未接入向量或 embedding。
4. **文件格式**：不支持 PPTX、OCR 和扫描 PDF 识别。
5. **依赖兼容警告**：`pg@8.22` 与 `@prisma/adapter-pg@7.9.1` 在事务路径会产生面向 pg 9 的弃用警告；当前无功能失败，升级依赖时必须复测。
6. **对象清理**：OSS 删除失败时数据库记录保持不变并允许重试，但没有独立的垃圾对象定时清理任务。
7. **容量与容灾**：尚无真实生产负载、跨地域容灾、RPO/RTO 和恢复演练结论。
8. **法律合规**：协议、隐私、未成年人和备案要求必须由项目负责人及法律顾问确认。

## 20. 相关文档

- [最终生产工程审查](./FINAL_PRODUCTION_REVIEW.md)
- [生产升级计划](./PRODUCTION_UPGRADE_PLAN.md)
- [架构说明](./ARCHITECTURE.md)
- [数据库说明](./DATABASE.md)
- [授权设计](./AUTHORIZATION.md)
- [AI 行为规范](./AI_BEHAVIOR.md)
- [DeepSeek 接入](./DEEPSEEK_INTEGRATION.md)
- [材料处理流水线](./MATERIAL_PIPELINE.md)
- [安全说明](./SECURITY.md)
- [隐私数据流](./PRIVACY_DATA_FLOW.md)
- [运维手册](./OPERATIONS.md)
- [阿里云部署](./ALIYUN_DEPLOYMENT.md)
- [验收标准](./ACCEPTANCE.md)
