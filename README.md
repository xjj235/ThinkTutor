# 问思学伴 ThinkTutor

ThinkTutor 是面向学生、教师与平台管理员的 AI 自主学习系统。核心闭环保持为：任务创建 → 知识诊断 → 3～6 轮苏格拉底追问（最多 8 轮可配置）→ 费曼讲解 → 五维形成性报告 → 从最高优先级漏洞再练。

## 技术架构

- Next.js 16 App Router、React 19、TypeScript strict、Tailwind CSS 4；
- PostgreSQL + Prisma 7；Tair/Redis + BullMQ；
- 私有阿里云 OSS（开发环境可用本地签名存储）；
- DeepSeek Chat Completions JSON Output + Zod 二次校验；
- Vitest、Playwright、ESLint、Docker、Nginx。

角色分为 `STUDENT`、`TEACHER`、`ADMIN`。公共注册只能创建学生，教师与管理员由管理员授权；管理员也可通过一次性 CLI 初始化。

## 目录

```text
prisma/                 PostgreSQL schema、migration、开发 seed
src/app/                页面与 Route Handlers
src/lib/ai/             mock / DeepSeek Provider、Prompt、Schema
src/lib/storage/        本地与阿里云 OSS Provider
src/lib/retrieval/      课程材料检索
src/worker/             材料解析 Worker
tests/                  单元与 PostgreSQL 集成测试
e2e/                    Playwright 端到端测试
deploy/                 Nginx、部署、备份、健康检查脚本
docs/                   架构、安全、数据库、运维与部署文档
```

## 环境要求

- Node.js 24；pnpm 11.19.0（只使用 pnpm）；
- PostgreSQL 16+；Redis 7+（无 Redis 时仅允许本地开发的进程内限流回退）；
- Windows 测试脚本包含工作区内临时 PostgreSQL，不修改系统数据库。

## 一键查看成果

只需要 Node.js 与 pnpm，不要求预装 Docker 或 PostgreSQL：

```powershell
pnpm install --frozen-lockfile
pnpm preview
```

首次运行会初始化工作区内的持久化 PostgreSQL、应用 migration、准备课程和三个演示角色，然后启动真实 Next.js 网页：

```text
http://127.0.0.1:3100
```

演示账号：

| 角色 | 邮箱 | 密码 |
|---|---|---|
| 学生 | `student@example.test` | `ThinkTutor-Preview-2026!` |
| 教师 | `teacher@example.test` | `ThinkTutor-Preview-2026!` |
| 管理员 | `admin@example.test` | `ThinkTutor-Preview-2026!` |

预览数据保存在 `.local-preview/`，按 `Ctrl+C` 停止后仍会保留。该模式固定使用 Mock AI 和本地存储，不产生模型费用。它不是单独的静态演示站：页面、API、Prisma 模型、认证和状态机均与阿里云部署共用；生产环境只替换为 RDS、Tair、OSS 和 DeepSeek 配置。

预览运行期间可在另一个终端执行三角色和双视口浏览器检查：

```powershell
pnpm preview:check
```

## 用户通过浏览器访问

ThinkTutor 是服务器返回 HTML 的标准 Web 应用。普通用户不需要运行任何命令：部署负责人启动服务后，用户只需在浏览器打开网址。

- 当前电脑：执行 `pnpm preview`，访问 `http://127.0.0.1:3100`；
- 同一可信局域网：执行 `pnpm preview:lan`，用户访问终端打印的 `http://局域网IP:3100`；
- 阿里云生产：用户访问配置好的 `https://正式域名`，Nginx 将请求转发到同一套 Next.js 应用。

局域网预览包含开发演示账号，只用于验收，不应直接暴露到公网或录入真实学生数据。完整说明见 [浏览器与 HTML 访问](docs/WEB_ACCESS.md)。

## 本地启动（Mock AI）

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose -f docker-compose.dev.yml up -d
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev
```

若使用开发 seed，先在 `.env` 设置 `DEV_SEED_PASSWORD`。Seed 只允许 `development` 或 `test`，绝不用于生产。Web 为 `http://127.0.0.1:3000`，Worker 另开终端运行：

```powershell
pnpm worker
```

开发账号为 `teacher@example.test`、`student@example.test`，密码等于你本地设置的 `DEV_SEED_PASSWORD`。

## DeepSeek V4 Flash

在仅服务端的 `.env` 设置：

```dotenv
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=your-server-side-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_TIMEOUT_MS=45000
```

代码不会读取 `NEXT_PUBLIC_DEEPSEEK_API_KEY`，也不会从浏览器直接调用模型。生产 `DEPLOYMENT_ENV=production` 会强制 `deepseek-v4-flash`、DeepSeek Provider、Redis 和 OSS 配置。真实收费 Smoke Test 默认关闭，参见 [DeepSeek 接入](docs/DEEPSEEK_INTEGRATION.md)。

## 数据库与管理员

```powershell
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed       # 仅开发
pnpm admin:create      # 交互输入，密码不回显
```

生产只使用 `prisma migrate deploy`，迁移前必须完成 RDS 备份，不使用 `migrate dev`，也不自动 seed。

## 验证

```powershell
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm e2e
```

`pnpm test` 与 `pnpm e2e` 会创建临时 PostgreSQL、真实应用 migration，结束后清理。首次 E2E 可执行 `pnpm exec playwright install chromium`，或设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向系统 Chrome。

## Docker 与阿里云

```bash
cp .env.production.example .env.production
cp .env.migration.example .env.migration
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml --profile tools run --rm --no-deps migrate
docker compose -f docker-compose.production.yml up -d
```

常驻 `web`/`worker` 只使用最小 DML 权限的应用账号；一次性 `migrate` profile 使用独立迁移账号，完成后不常驻。PostgreSQL 与 Redis 必须使用同 VPC 的 RDS/Tair，不放入生产 Compose。完整步骤见 [阿里云部署](docs/ALIYUN_DEPLOYMENT.md)、[安全验证报告](docs/SECURITY_VALIDATION.md) 和 [运维手册](docs/OPERATIONS.md)。

## 健康检查

- `/api/health/live`：仅检查 Web 进程；
- `/api/health/ready`：检查 PostgreSQL，配置 Redis 时同时 `PING`，不会发起收费 AI 调用。

## 已知边界

形成性报告不代表正式成绩或标准化能力测评。当前不实现支付、排行榜、社交、直播、小程序、原生 App、家长端、心理或医学诊断。向量检索保留接口，当前生产可用确定性的 PostgreSQL 词法检索回退。

## 常见问题

- 浏览器显示 `127.0.0.1 拒绝连接`：先确认运行 `pnpm preview` 的终端仍保持开启，再访问完整地址 `http://127.0.0.1:3100`（必须包含 `:3100`）。仅输入 `127.0.0.1` 会访问默认 80 端口，本项目不会监听该端口。
- 开启系统代理后本地预览打不开：保留代理开启，同时把 `localhost`、`127.0.0.1` 和 `127.*` 加入代理绕过列表；也可访问 `http://localhost:3100`。不要把本地预览通过公网代理暴露给外部用户。阿里云生产环境使用正式 HTTPS 域名，不依赖该绕过设置。
- `pnpm prisma:migrate` 连接失败：确认 PostgreSQL 已启动，且 `DATABASE_URL` 与白名单正确；测试命令会自行启动临时 PostgreSQL，不依赖本地 Docker。
- Seed 被拒绝：生产环境禁止 seed；在开发环境设置 `DEV_SEED_PASSWORD` 后执行。
- DeepSeek 启动失败：`AI_PROVIDER=deepseek` 时必须提供仅服务端可读的 `DEEPSEEK_API_KEY`；生产还会校验模型名、Redis 与 OSS。
- E2E 找不到浏览器：安装 Playwright Chromium，或把 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向系统 Chrome。
- 材料停在 `QUEUED`：确认 Redis/Tair 与独立 `pnpm worker` 进程都已运行，再从教师端重新处理失败材料。
