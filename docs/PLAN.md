# ThinkTutor 实施计划（生产升级版）

本计划由原 MVP 计划演进而来，详细执行记录见 `PRODUCTION_UPGRADE_PLAN.md`。产品范围保持：任务创建 → 诊断 → 3～8 轮苏格拉底追问 → 费曼讲解 → 形成性报告 → 从最高优先级漏洞再练。

## 已实施阶段

1. 保留并备份 SQLite MVP，导出旧数据；
2. 迁移到 PostgreSQL 与规范化生产模型；
3. 用户认证、RBAC、课程、章节、目标、班级和任务；
4. 使用 `deepseek-v4-flash` 的服务端 DeepSeek Provider，Mock 用于测试；
5. 升级学习状态机、报告与漏洞再学习；
6. 私有 OSS/本地 Storage Provider、BullMQ Worker、课程检索；
7. 学生、教师、管理员页面与分析接口；
8. Tair 限流/锁/队列、结构化日志、健康检查；
9. Docker、Nginx、CI 与阿里云部署文档；
10. PostgreSQL 单元/集成测试和桌面/移动 Playwright 验收。

## 不在当前范围

支付、排行榜、社交、直播、微信小程序、原生 App、家长端、正式自动成绩、心理或医学诊断。

## 完成门槛

必须实际通过 frozen install、Prisma generate/migration/seed、typecheck、lint、unit/integration、build、E2E；真实 DeepSeek、RDS/Tair/OSS/ECS、DNS/SSL/备案与法律审核只能由负责人在真实生产资源上完成，不能伪报。
# HTML 产品交付原则

所有学生、教师与管理员日常功能最终必须由浏览器中的 HTML 页面完成。API、数据库服务和后台 Worker 是页面背后的服务端实现，不能替代用户页面。项目使用同一套 Next.js 应用支持本机、可信局域网和阿里云生产部署；生产环境通过域名与 HTTPS 访问，由 Nginx 反向代理到内部 Web 服务，数据、AI Key、Cookie 和云凭据不得暴露到浏览器。
