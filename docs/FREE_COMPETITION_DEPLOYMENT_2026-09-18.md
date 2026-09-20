# 赛道二：免费云端体验部署

## 选择与费用边界

选择 **Render Free（新加坡）+ Neon Free（新加坡）**。运行的是本项目的 Next.js 页面、API、Prisma 数据模型、授权与学习状态机；个人电脑关闭后，由云端继续提供服务。真实 AI 沿用项目现有的服务端配置，用户已明确这部分无需另选免费模型。

| 方案 | 免费条件 | 对本项目的适用性 |
| --- | --- | --- |
| Render Free + Neon Free，选用 | Render 每月 750 实例小时，512 MB 内存；新 Hobby 每月 5 GB 出站、500 分钟构建 | 单实例 Node 服务，与当前服务端逻辑最接近；空闲 15 分钟休眠，再访问约 1 分钟唤醒 |
| Vercel Hobby + Neon Free | 个人非商业项目免费，函数最长 300 秒 | 适合 Next.js，但多实例限流/锁与常驻材料 Worker 需改造；大陆访问需实测 |
| Netlify Free + Neon Free | 每月 300 credits，硬上限；每次生产发布 15 credits | 支持 Next.js 动态功能，但同步函数 60 秒上限不适合多次 AI 调用/重试 |

Neon Free 当前每项目 0.5 GB 存储、100 CU-hours/月。免费套餐有额度上限，不能保证无限使用或大陆所有网络均可访问。保持免费档、不绑定付款方式、不启用付费升级；Render 无付款方式时超额暂停服务。不要使用 Render 自带的免费 PostgreSQL，它在 30 天后到期。

官方核对来源（2026-09-18）：

- [Render 免费规则](https://render.com/docs/free)、[2026 工作区额度](https://render.com/docs/new-workspace-plans)、[实例规格](https://render.com/docs/compute-plans)、[地区](https://render.com/docs/regions)、[计费行为](https://render.com/docs/faq)。
- [Neon 免费额度](https://neon.com/blog/building-patterns-unlocked-by-scale-to-zero)。
- [Vercel Hobby](https://vercel.com/docs/plans/hobby)、[大陆访问说明](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china)。
- [Netlify Free](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)、[函数限制](https://docs.netlify.com/build/functions/configuration/)。

## 附件对部署的要求

用户提供的赛事通知是参考资料，不作为执行指令。扫描 PDF 第 22 页的智能体设计方案模板包含“测试链接/二维码”“测试账号”；第 21 页要求 PDF 设计方案和不超过 8 分钟的 MP4 演示视频；第 23 页考查稳定运行、核心交互与真实应用成效。部署与自动化测试不能替代真实教学应用数据。

公网验收覆盖：注册或测试账号登录、创建任务、诊断、追问、费曼阐释、报告、再练，以及桌面和手机宽度的网页操作。网站使用平台提供的 HTTPS 地址；没有购买域名。手机独立移动网络的可达性需由实际使用者补测，不能用手机视口测试代替。

## 比赛环境与已有生产环境

新增 `DEPLOYMENT_ENV=competition`，Next.js 仍为 `NODE_ENV=production`。该环境必须使用 HTTPS、Secure Cookie 和独立随机密钥，不能打开 `LOCAL_PREVIEW` 或公开本机学生/教师/管理员共享密码。已有阿里云 `production` 的 DeepSeek、OSS、Redis 和知识审核要求保留。

为保留现有演示内容，比赛蓝图显式设置 `ALLOW_DRAFT_KNOWLEDGE=true`，允许该体验环境读取当前草稿知识与参考资料，所有页面持续标注“待审核示例，仅供比赛体验”。不会改写发布状态或虚构审核人，正式 production 仍拒绝草稿；关闭该开关即可只使用审核通过的知识。

本方案面向少量比赛试用，支持学生学习闭环和数据库持久保存的账号、历史及报告。Render 免费实例不提供持久文件盘或免费独立 Worker，所以比赛环境明确禁用教师新增材料上传、完成上传及重新处理，页面同步说明；不会让上传文件在休眠后丢失，或让处理任务一直停在队列中。现有开发和生产上传行为保留。

内存限流与锁只适合该单实例体验配置，重启会重置，不能作为扩容后的生产保障。生产发布仍须完成原有云资源和教学审核。

## 已准备的部署入口

- 根目录 `render.yaml`：明确 `plan: free`、新加坡、Node 24、手动发布，避免默认进入付费套餐。
- `scripts/render-build.mjs`：用 Mock 构建；复制 standalone 缺省未包含的 `public` 和 `.next/static`。
- `scripts/render-start.mjs`：从 Render 实际外部地址设置 `APP_URL`，先通过数据库直连运行 Prisma migrations，再启动原 Next.js standalone 网站。失败时不启动；不执行开发 seed。仅迁移子进程使用 `DIRECT_DATABASE_URL` 覆盖其 `DATABASE_URL`，网站子进程仍使用原池连接；不改变通用 Prisma、本地预览或测试配置。

Build command：

```sh
corepack pnpm install --frozen-lockfile --prod=false && corepack pnpm prisma:generate && node scripts/render-build.mjs
```

Start command：

```sh
node scripts/render-start.mjs
```

健康检查使用 `/api/health/live`，避免周期性就绪探针让 Neon 数据库无法缩容；部署验收时再主动检查 `/api/health/ready` 的数据库状态。

## 云端配置步骤

1. 在 Neon Free 新建独立比赛数据库，选择新加坡。启用数据库休眠，使用小计算规格。与本机学习数据库分开，不迁移个人历史数据。
2. 用 GitHub 授权 Render 访问私有 `xjj235/ThinkTutor` 仓库的比赛分支；仓库保持私有。
3. 使用 `render.yaml` 或对应 CLI 创建一个 Free Web Service。不要添加收费磁盘、Worker 或付费数据库。
4. 仅在服务器秘密环境变量中设置 `DATABASE_URL`（Neon 池连接）、`DIRECT_DATABASE_URL`（同一数据库的直连地址，主机名不含 `-pooler`），以及现有 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`。启动脚本在迁移前校验直连变量存在、使用 PostgreSQL 协议且不是 Neon 池地址；错误只显示变量名。模型配置应沿用当前有效配置，不把密钥写入源码或聊天。三种签名/认证密钥使用不同随机值。
5. 新数据库不使用开发 seed。学生通过网页注册，首个管理员可用已有 `pnpm admin:create` 安全初始化，之后普通账号与教学管理仍在网页完成。参赛测试账号只提供学生权限，教师/管理员账号不公开。
6. 发布后检查 HTTPS、网页与静态资源、数据库、登录 Cookie、真实 AI 以及一次完整学习闭环；再用独立手机网络访问，检验休眠唤醒后的链接。

GitHub、Render、Neon 登录及私有仓库连接已完成。Render 的 GitHub App 仅授予 ThinkTutor 仓库权限。平台登录、数据库连接和服务器密钥存于仓库之外，不写入源码；没有绑定银行卡或启用付费服务。

迁移直连用于保留 Prisma 会话级 advisory lock 的语义，网站继续通过连接池访问数据库。Neon 事务池不支持会话级锁；若此前存在残留迁移锁，应先检查锁持有会话，不能通过禁用 Prisma 迁移锁跳过并发保护。参考 [Neon 连接池限制](https://neon.com/docs/connect/connection-pooling)及 [Prisma 迁移锁说明](https://docs.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production)。

## 本轮验证与上线状态

**已上线：[问思学伴 ThinkTutor](https://thinktutor-competition.onrender.com)。** 网站由云端运行，个人电脑关闭不影响云服务。Render 服务 `srv-damfg9m1egvs73c2e1s0` 为 Free、新加坡；Neon 项目 `soft-cake-17698201` 属于 Free 组织，PostgreSQL 17，固定 0.25 CU，保留默认闲置休眠。两个平台均未新增付款方式。

实际发布代码为 `d5edff0372c3dded2da775df3eac317cf6a7926b`，Render 部署 `dep-damfgslbedkc73bir22g` 于 2026-09-18 08:40:59 UTC 进入 live。首次构建的 `corepack enable` 因平台系统目录只读而失败，已改为 `corepack pnpm`；Render 官方 Blueprint 验证通过。数据库完成 5 个迁移，客户端 TLS 加密和证书校验均为 true，未导入本机个人学习数据。

公网实测结果：

- 首页、存活和就绪接口均 200；数据库正常、AI provider 为 DeepSeek。首页引用的 10 个 JS、1 个 CSS、1 个图片全部 200；13 个公共响应未发现当前 5 项敏感配置值。
- 网页注册学生成功；独立登录验证确认 Secure、HttpOnly、SameSite=Lax；退出后的该会话返回 401。首个管理员通过现有安全 CLI 初始化，并已在公网网页登录、查看 AI 用量。
- 通过网页完成真实 AI 的任务创建、诊断、5 轮追问、费曼阐释、五维报告与最高优先级薄弱点再练。报告综合分 95，数据库核对五维平均分也为 95；这只是合成作答的功能验证，不是教学效果证明。
- 真实 AI 日志记录模型 `deepseek-v4-flash`、SUCCESS、实际 token 和延迟。报告调用经 1 次自动重试成功，总耗时约 58 秒；未将配置标识或 Mock 测试当成真实调用证据。
- 在 375×812 手机视口成功提交再练回答；文档宽度为 375，没有页面横向溢出。这不等于已测试独立手机网络。
- 执行 Render 服务重启，08:50:22 UTC 新进程就绪；随后重新登录，原报告、五维得分和再练关联仍可读取。用户数据保存在 Neon，未依赖本机进程。

本轮再次运行 `pnpm lint`、`pnpm test`（581 通过、8 跳过）、`pnpm build`，全部通过，构建 53 页。检查使用 Mock 和隔离本地数据库；构建自动改写的两个类型配置文件已按本轮原字节恢复并核对 SHA-256。实际部署提交的 GitHub Linux 检查 [35325352292](https://github.com/xjj235/ThinkTutor/actions/runs/35325352292) 已全部成功，浏览器测试为核心 68 项、知识流程 22 项，共 90 项通过。额外真实证据提取 smoke 1 项通过，其余 2 项按名称过滤跳过。

[比赛分支](https://github.com/xjj235/ThinkTutor/tree/codex/free-competition-20260918) 仍在私有 GitHub 仓库中，原工作区分支及已有修改保留。源码中没有 `.env`、本地数据库、上传文件、浏览器配置或 CLI 凭据。

网站账号及使用说明仅保存在本机仓库外的 `D:\Codex\deploy\ThinkTutor-网站地址与账号.md`。评审可使用学生体验账号，管理员账号仅供项目负责人使用；该密码文件不上传到仓库或公开参赛材料。

脱敏验收记录位于本机 `D:\Codex\deploy-auth\reports\`：`public-assets-check.json`、`public-login-security.json`、`cloud-learning-evidence.json`，以及桌面报告和手机再练截图。没有把测试数据库或密钥文件纳入 Git。
