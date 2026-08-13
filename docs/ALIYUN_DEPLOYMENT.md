# 阿里云生产部署

目标拓扑：DNS → ECS/EIP 上的 Nginx 443 → `web` 容器 3000；`web` 与 `worker` 通过同一 VPC 私网访问 RDS PostgreSQL、Tair Redis 和 private OSS，服务端经 HTTPS 调用 DeepSeek。生产 Compose 不包含数据库或 Redis。

## 一、购买资源

准备 ECS、RDS PostgreSQL、Tair Redis、OSS、域名和 SSL 证书。生产和测试账号、Bucket、数据库必须分离；容量、地域和可用区由实际用户量与恢复目标决定。中国内地公网服务还应在上线排期中预留备案时间。

## 二、网络规划

在同地域创建 VPC 与 vSwitch，把 ECS、RDS、Tair 放入私网；只让 ECS/Nginx 接受公网流量。RDS、Tair 和 OSS 优先使用内网 Endpoint。规划不冲突的 CIDR，并记录生产、预发布和运维入口。

```text
VPC
└─ vSwitch
   ├─ ECS: Nginx + web + worker
   ├─ RDS PostgreSQL
   └─ Tair Redis
```

## 三、安全组

- 公网仅开放 80/443；22 仅允许固定运维 IP 或堡垒机。
- 不开放 3000、5432、6379 到公网。
- RDS/Tair 白名单只允许应用 vSwitch/ECS 安全组。
- 容器启用 `no-new-privileges`，Web/Worker 使用非 root 用户。

## 四、RDS PostgreSQL

创建 UTF-8 数据库和两个分离账号，启用自动备份、删除保护和必要的 SSL；配置 VPC 白名单：

- `app_user`：仅拥有 ThinkTutor 运行所需的表 DML/序列权限，不授予建表、改表、删库和角色管理权限；只放入 `.env.production`。
- `thinktutor_migrator`：拥有 ThinkTutor schema 的迁移权限，仅在部署 migration 容器运行期间使用；只放入 `.env.migration`，绝不提供给 Web/Worker。

连接串文件均不入库：

```dotenv
DATABASE_URL=postgresql://app_user:password@private-rds-host:5432/thinktutor?sslmode=require
```

上线前先创建快照/备份，再使用 `.env.migration` 执行 `pnpm prisma:migrate`；生产禁止 `migrate dev` 和自动 seed。可选 `pg_trgm` 必须由 DBA 审核后执行 `deploy/sql/optional-pg-trgm.sql`，未启用时系统使用确定性词法回退。

## 五、Tair Redis

创建 VPC 实例、密码/TLS（产品与客户端支持时）并设置白名单。配置：

```dotenv
REDIS_URL=redis://:password@private-tair-host:6379/0
```

生产环境缺少 Redis 会在环境校验阶段失败；Tair 用于限流、分布式锁和 BullMQ，不能用进程内回退替代。

## 六、OSS

创建 private Bucket，禁止公共读写，设置生命周期与服务端加密。仅允许应用前缀所需的 Put/Get/Head/Delete 权限，不授予全局管理员。

- 首选给 ECS 绑定最小权限 RAM Role；应用通过 IMDSv2 自动发现，`OSS_ROLE_ARN` 留空。
- 跨账号 AssumeRole 才设置 `OSS_ROLE_ARN`，并同时提供最小权限源 AK；临时 STS Token 可配置 `OSS_STS_TOKEN`。
- 浏览器只接收 5～10 分钟 Presigned URL；长期 AK 不返回前端。
- CORS 仅允许正式站点 Origin、PUT 所需 Header 和必要方法。
- 上传完成后服务端执行 Head 二次校验；对象键随机化，不采用用户文件名。

## 七、ECS

1. 安装 Docker Engine、Docker Compose 插件和 Nginx。
2. Clone/上传代码，分别复制 `.env.production.example` 与 `.env.migration.example`；文件权限限制为部署用户可读，二者均不入库。
3. 填写 `DEPLOYMENT_ENV=production`、DeepSeek、RDS、Tair、OSS 与 64 字符随机 `AUTH_SECRET`。
4. 构建：`docker compose -f docker-compose.production.yml build`。
5. 备份 RDS 后迁移：`docker compose -f docker-compose.production.yml --profile tools run --rm --no-deps migrate`。
6. 启动：`docker compose -f docker-compose.production.yml up -d`。
7. 确认 Web 和 Worker 日志没有密钥、密码、完整学习正文或隐藏推理。

## 八、域名

完成域名注册和实名认证后，将 DNS A 记录指向 ECS EIP；发布前可降低 TTL，确认切换后再恢复。`APP_URL` 必须与最终 HTTPS Origin 一致。

## 九、HTTPS

签发证书，把 `deploy/nginx/thinktutor.conf.example` 复制到 Nginx，替换域名和证书路径。先运行 `nginx -t`，再 reload；强制 80 → 443，配置安全 Header 和上传大小限制。续签必须有监控。

## 十、中国内地备案

中国内地 ECS 的公网网站通常需要域名实名认证与 ICP 备案；上线后还可能涉及公安联网备案。具体法律义务由主体、业务和地域决定，必须由负责人/法律顾问确认，代码不能替代合规判断。

## 十一、上线验证

依次检查 `/api/health/live` 与 `/api/health/ready`；ready 必须真实连接 RDS 和 Tair，但不会产生收费 AI 调用。然后以学生、教师、管理员最小账号做权限 smoke，并在显式开关下运行一次真实 DeepSeek smoke。检查 Nginx、容器、AIUsage、AuditLog 和 Worker 错误日志。

在 ECS 的发布目录加载真实 `.env.production` 后运行：

```bash
pnpm acceptance:production
DEEPSEEK_LIVE_TEST=true pnpm test:deepseek:live
```

第一条命令会拒绝 HTTP、非 production、非 DeepSeek、非 OSS 或缺少 RDS/Tair/OSS/DeepSeek 配置的环境，并验证公网 HTML、live、RDS/Tair ready 与 HTTPS 安全响应头；它不打印密钥。第二条命令会产生一次真实 DeepSeek 请求，必须由上线负责人显式开启并核对 AIUsage。private OSS 上传/删除、Worker 消费、ECS 安全组、RDS 备份恢复和 Tair ACL 仍需按下表人工留证，不能只凭本地测试宣称通过。

## 十二、回滚

保留上一版本镜像标签与 `.env.production` 加密备份。应用失败时回切上一镜像；数据库 migration 采用向前兼容，不能假设回滚镜像会撤销 schema。破坏性 schema 改动必须拆成“新增—回填—切换—清理”，回滚前先核对兼容性与备份。

## 十三、备份

- 上线前与定期执行 RDS 自动/手动备份，并做恢复演练。
- private OSS 开启版本控制或合理生命周期，验证误删恢复策略。
- 生产环境变量、Nginx 配置与部署清单加密备份，不备份明文密钥到仓库。
- 记录 RPO/RTO、备份负责人、保留周期和最近一次恢复演练时间。

## 上线前人工清单

- [ ] 购买 ECS、RDS、Tair、private OSS；
- [ ] 创建最小权限 RAM Role 和生产 Secrets；
- [ ] 创建 DeepSeek API Key 并完成真实 smoke；
- [ ] 域名注册、实名认证、DNS、SSL；
- [ ] 完成适用的 ICP/公安备案；
- [ ] 通过交互 CLI 创建 ADMIN；
- [ ] 完成数据库备份、Production Migration 和恢复演练；
- [ ] 验证 live/ready、告警、日志与回滚；
- [ ] 完成用户协议、隐私政策和未成年人条款法律审核。
