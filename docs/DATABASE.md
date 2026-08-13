# 数据库

生产数据库为 PostgreSQL，Prisma schema 包含用户/认证、课程/章节/目标、班级/成员、任务/学生进度、材料/片段、学习会话/消息、规范化报告、AIUsage 与 AuditLog。

## SQLite 增量迁移保护

升级前统计：旧 SQLite `User=不存在`、`LearningSession=1`、`Message=1`、`LearningReport=0`。原始 `dev.db` 与关键配置保存在忽略目录 `backups/production-upgrade-20260809-2305`，未覆盖原文件；`scripts/export-legacy-sqlite.ts` 导出并输出 SHA-256，`scripts/import-legacy-data.ts` 支持 dry-run/apply。

MigrationWarning：旧记录没有 `userId`。导入 PostgreSQL 时必须由操作人员选择一个明确的归属学生账号；工具不得静默猜测。旧 JSON 报告若存在，需要拆分为维度、优势、漏洞和下一步子表，并保留“旧版未保存独立证据”的明确说明。

## Migration

基线位于 `prisma/migrations-postgresql/20260809152816_production_baseline`，已经在真实临时 PostgreSQL 上执行。生产流程：RDS 备份 → `pnpm prisma:generate` → `pnpm prisma:migrate` → 验证数量与健康检查。禁止生产执行 `prisma migrate dev` 或自动 seed。

所有关键外键均定义 Cascade/SetNull/Restrict；Message.clientRequestId、报告 sessionId、成员和任务进度复合键用于幂等与一致性。索引覆盖所有者、成员、阶段、状态、更新时间、课程/章节和 AIUsage 查询。
