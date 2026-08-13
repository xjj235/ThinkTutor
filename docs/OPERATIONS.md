# 运维手册

## 部署

1. 备份 RDS，并验证备份可恢复；
2. 构建带版本号的 web/worker 镜像；
3. 运行 `prisma migrate deploy`；
4. 启动 worker 与 web；
5. 检查 `/api/health/live`、`/api/health/ready` 和 Nginx 日志；
6. 使用 mock 禁止生产，执行一次授权的真实 DeepSeek smoke test。

## 监控

观察 HTTP 5xx、P95 延迟、ready 失败、RDS 连接、Tair 内存、BullMQ 失败、Material FAILED、AI 429/超时/无效输出、Token 量。requestId 用于关联应用日志、AIUsage 和 AuditLog。

## 回滚

保留上一版本镜像并先判断 migration 是否向后兼容。应用可回滚到上一镜像；数据库禁止未经评审直接 down migration。若 migration 不兼容，使用已验证的 RDS 备份并执行正式恢复流程。OSS 与配置分别备份，密钥轮换后立即撤销旧凭据。

## 备份

使用 RDS 自动备份/PITR，加部署前逻辑备份；私有 OSS 配置生命周期与版本控制；`.env.production` 进入受控 Secret 管理，不进入代码仓库。
