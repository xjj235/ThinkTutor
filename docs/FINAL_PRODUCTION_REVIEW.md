# ThinkTutor 最终生产工程审查

审查日期：2026-08-10。结论：代码、数据库迁移、Mock AI 完整业务闭环、生产构建与本机浏览器验收已通过；真实 DeepSeek 和阿里云资源尚无凭据/资源，不能标记为已上线。

## 一、最终架构

Next.js 16 App Router 同时承载中文 Web 与服务端 Route Handlers；Prisma 7 通过 PostgreSQL adapter 连接 RDS；Redis/Tair 提供限流、锁和 BullMQ；独立 Worker 解析私有 OSS 材料；DeepSeek Provider 只在服务端调用 `deepseek-v4-flash`。Nginx/HTTPS 位于 ECS 容器前，生产 Compose 仅包含 Web 与 Worker。

## 二、完成的功能

完成注册登录、三角色工作台、课程/章节/目标、班级/成员、任务发布、材料、学生历史与学习档案、教师分析、管理员用户/AI/材料/审计页面，以及“诊断→3～8 轮受服务端约束的追问→费曼→五维报告→最高优先级漏洞再练”闭环。AI 失败不会写消息、推进阶段或增加轮数。

## 三、数据库结构

生产 datasource 为 PostgreSQL。核心模型包含 User/AuthSession、Course/Chapter/LearningGoal、Classroom/Enrollment、Assignment/AssignmentStudent、Material/MaterialChunk、LearningSession/Message、规范化报告子表、AIUsage、AuditLog。外键按资源语义使用 Cascade/SetNull/Restrict，关键查询和幂等字段有索引/唯一约束。基线 migration 已在多次全新临时 PostgreSQL 上部署，seed 已实际运行。

旧 SQLite 未覆盖或删除；保留只读导出、校验和 dry-run/显式写入导入脚本与本地备份。生产 Prisma 配置只指向 `migrations-postgresql`。

## 四、AI 架构

`AIProvider` 有确定性 Mock 与 DeepSeek 实现；诊断、教练、费曼要求、报告、再练、摘要和材料关键词均使用 Zod 结构化输出。Prompt 把学生输入/参考材料放入不可信边界，系统决定状态转换。DeepSeek 请求有 JSON Output、二次验证、超时、最多两次指数退避、401/403/429/5xx/网络/空输出分类、匿名 user 哈希和 AIUsage；报告 overallScore 由服务端五维平均计算。

## 五、DeepSeek V4 Flash 真实接入状态

模型名来自 `DEEPSEEK_MODEL`，生产强制为 `deepseek-v4-flash`；接口实现、错误测试和显式 live smoke 测试已完成。当前没有 `DEEPSEEK_API_KEY`，live 测试为 1 项按条件跳过，未发送真实请求、未验证账户额度/区域网络/真实模型输出。

## 六、用户体系

Argon2id 密码、随机不透明数据库 Session、HttpOnly/SameSite Cookie、登录/注册限流、改密撤销全部 Session、退出、资料更新与受约束的账号删除均已实现。公开注册只能创建 STUDENT；教师/管理员由管理员变更角色或一次性 CLI 创建。

## 七、权限体系

所有受保护 API 在服务端执行认证、角色和资源所有权/成员关系校验；学生会话/报告隔离、教师课程/班级隔离、管理员接口边界已有 E2E。可写 API 做同源校验，JSON 输入做 Zod。关键身份与业务事件写 AuditLog；失败登录仅保存邮箱哈希。管理员不能自助删除，教师存在归属资源时不能触发级联删除。

## 八、材料系统

StorageProvider 支持 Local 和 Aliyun OSS；对象键随机、private URL 短时签名、扩展/MIME/大小与 Head 二次校验、路径包含检查齐全。OSS 支持显式 STS/AK、跨账号 RAM Role ARN，以及首选 ECS RAM Role IMDSv2。Worker 支持 PDF/DOCX/TXT/MD 的签名检查、抽取、清洗、分块、关键词、重试、失败原因和幂等；检索按 course/chapter 隔离并限制上下文预算。

## 九、学生流程

首页、注册/登录、dashboard、自主任务、班级、作业、会话、报告、历史、资料和学习档案已连接数据库 API。刷新从数据库恢复；提交有加载/错误/重试/幂等；报告含五维证据、优势、漏洞、下一步与形成性免责声明。完整闭环在 1440×900 和 375×812 实际浏览器通过。

## 十、教师流程

教师可创建课程、章节、目标、班级和任务，发布到已加入学生，管理材料并查看班级分析和学生报告。E2E 已实际完成“教师建课/班/任务→学生加入并完成→教师看到报告链接”。

## 十一、管理员流程

管理员可查看总览、用户、AIUsage、材料失败任务、系统状态和审计日志，并可受服务端保护地修改角色/状态。不能通过公开注册或普通 API 自助提权，高风险变更包含 requestId 审计。

## 十二、阿里云部署结构

已生成非 root 多阶段 Dockerfile、开发/生产 Compose、Nginx 示例、CI、部署/备份/健康脚本、生产环境模板和完整 ECS/RDS/Tair/OSS/DNS/HTTPS/备案/回滚文档。当前机器没有 Docker、阿里云资源、域名或证书，因此未执行容器 build 和云端部署。

## 十三、测试结果

- `pnpm lint`：通过，0 warning。
- `pnpm typecheck`：通过。
- `pnpm test`：13 个测试文件、54 项通过；1 个 live 文件中的 1 项因无密钥跳过。
- `pnpm build`：通过，47 个 App Router 页面/接口完成生产构建。
- `pnpm e2e`：14/14 通过，Chromium 1440×900 与 375×812。
- DeepSeek live：无密钥，1 项跳过；没有伪造成功结果。

合计自动执行 68 项通过（Vitest 54 + Playwright 14），另有 1 项真实 DeepSeek smoke 按条件跳过。

## 十四、实际执行命令

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
pnpm exec tsx scripts/with-test-postgres.ts -- pnpm exec vitest run tests/unit/storage.test.ts tests/integration/material-worker.test.ts
```

此外实际执行了基线检查、SQLite 只读导出、依赖/Secrets/`any`/TODO/OpenAI/硬编码模型/可写 API 同源与 Zod 扫描，以及带 `--trace-deprecation` 的 PostgreSQL adapter 警告定位。

## 十五、尚未验证内容

- 真实 DeepSeek API、余额、延迟和输出质量；
- RDS、Tair、private OSS、ECS RAM Role、ECS/Nginx、Docker 镜像构建；
- 域名、DNS、SSL、ICP/公安备案；
- 旧 SQLite 数据写入真实 RDS（导出和导入机制已准备，需负责人确认归属）；
- 生产负载、故障注入、告警、RDS 恢复和灾备演练。

## 十六、上线前人工操作

- [ ] 购买 ECS；
- [ ] 创建 RDS PostgreSQL；
- [ ] 创建 Tair Redis；
- [ ] 创建 private OSS；
- [ ] 创建 DeepSeek API Key；
- [ ] 设置生产环境变量和 Secrets；
- [ ] 创建最小权限 RAM Role；
- [ ] 域名注册与实名认证；
- [ ] 完成适用的 ICP/公安备案；
- [ ] 签发 SSL 证书并设置 DNS；
- [ ] 通过 CLI 创建首个 ADMIN；
- [ ] 执行真实 DeepSeek smoke；
- [ ] 完成数据库备份与 Production Migration；
- [ ] 验证 live/ready、日志、告警和回滚；
- [ ] 审核用户协议、隐私政策与未成年人条款。

## 十七、安全检查

扫描未发现显式 `any`、ts-ignore、TODO/FIXME、console、前端密钥、OpenAI Provider 或硬编码其他模型；可写 API 均有同源/签名边界，JSON 均经 Zod。日志配置脱敏密码、Token、Cookie、Authorization 和云/AI Secrets；模型不返回隐藏推理。生产环境强制 DeepSeek、Redis、OSS、强 AUTH_SECRET。保留的 SQLite 只存在 legacy 脚本/迁移档案，不是生产 datasource。

## 十八、已知限制

- 未完成真实云资源和收费 AI 验收，因此当前状态是“代码与本机工程门禁通过”，不是“已生产上线”。
- 课程检索目前是 PostgreSQL 词法策略；向量/embedding 仅保留 Provider 扩展点。
- PPTX 未启用，需先转 PDF；OCR 与扫描件识别未实现。
- `pg@8.22` 与 `@prisma/adapter-pg@7.9.1` 在嵌套/交互事务中产生一条 pg 9 兼容性弃用警告；已定位到 adapter 的 `PgTransaction.performIO`，当前测试无功能失败，升级依赖时必须复测。
- OSS 删除失败时数据库记录保持原状，可由相同 API 重试；尚无独立对象垃圾回收定时任务。
- 多地域容灾、性能容量结论和法律合规结论必须在真实生产条件下完成。
