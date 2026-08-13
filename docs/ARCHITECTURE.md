# ThinkTutor 生产架构

## 运行拓扑

Internet → DNS → ECS Nginx :443 → Next.js web :3000。Web 与独立材料 Worker 通过 VPC 访问 RDS PostgreSQL、Tair Redis、私有 OSS，并从服务端调用 DeepSeek。

## 边界

- Route Handler：Zod 输入、同源检查、认证、RBAC/资源授权、统一响应；
- Domain Service：事务、一致性、幂等、状态机调用；
- AI Provider：`mock | deepseek`，结构化 JSON 后执行 Zod 二次验证；
- PostgreSQL：唯一主数据源；Redis 只承担限流、短锁和队列；
- Storage Provider：本地开发签名 URL或私有 OSS 短时签名 URL；
- Worker：魔数校验、PDF/DOCX/TXT/MD 提取、语义段落切块、幂等写入。

## 学习状态

`DIAGNOSIS → SOCRATIC → FEYNMAN → REPORTING → COMPLETED`，主动终止进入 `ABANDONED`。纯函数位于 `src/lib/state-machine.ts`，React 不决定转换。AI 先生成，服务端验证后才进入可序列化事务；AI 失败时阶段、轮数和消息均不变化。

主动进入费曼要求至少 3 轮、概念/因果/证据覆盖、至少三类问题和可验证 LearnerState；达到 `maxTurns` 强制进入。报告五维数据规范化保存，`overallScore` 由服务端算术平均。

## 一致性

消息 `clientRequestId` 全局唯一；会话 `version` 乐观并发控制；写事务使用 PostgreSQL `ReadCommitted` 并以条件更新检测冲突；Redis 会话级短锁降低重复 AI 调用。报告、消息、重试与课程层级使用明确 Cascade/SetNull/Restrict 删除规则。

## 检索

AI 上下文由当前任务、对话摘要、最近消息和同课程/章节材料片段构成。检索接口可替换，当前词法实现使用 PostgreSQL 数据与稳定评分；可选 `pg_trgm` SQL 位于 `deploy/sql/optional-pg-trgm.sql`。
