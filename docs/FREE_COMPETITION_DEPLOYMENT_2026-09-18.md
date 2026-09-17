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

最终交付网址前，需使用桌面浏览器和手机实际完成：注册或测试账号登录、创建任务、诊断、追问、费曼阐释、报告、再练。网站应使用平台提供的 HTTPS 地址；这里没有购买域名。

## 比赛环境与已有生产环境

新增 `DEPLOYMENT_ENV=competition`，Next.js 仍为 `NODE_ENV=production`。该环境必须使用 HTTPS、Secure Cookie 和独立随机密钥，不能打开 `LOCAL_PREVIEW` 或公开本机学生/教师/管理员共享密码。已有阿里云 `production` 的 DeepSeek、OSS、Redis 和知识审核要求保留。

为保留现有演示内容，比赛蓝图显式设置 `ALLOW_DRAFT_KNOWLEDGE=true`，允许该体验环境读取当前草稿知识与参考资料，所有页面持续标注“待审核示例，仅供比赛体验”。不会改写发布状态或虚构审核人，正式 production 仍拒绝草稿；关闭该开关即可只使用审核通过的知识。

本方案面向少量比赛试用，支持学生学习闭环和数据库持久保存的账号、历史及报告。Render 免费实例不提供持久文件盘或免费独立 Worker，所以比赛环境明确禁用教师新增材料上传、完成上传及重新处理，页面同步说明；不会让上传文件在休眠后丢失，或让处理任务一直停在队列中。现有开发和生产上传行为保留。

内存限流与锁只适合该单实例体验配置，重启会重置，不能作为扩容后的生产保障。生产发布仍须完成原有云资源和教学审核。

## 已准备的部署入口

- 根目录 `render.yaml`：明确 `plan: free`、新加坡、Node 24、手动发布，避免默认进入付费套餐。
- `scripts/render-build.mjs`：用 Mock 构建；复制 standalone 缺省未包含的 `public` 和 `.next/static`。
- `scripts/render-start.mjs`：从 Render 实际外部地址设置 `APP_URL`，先运行 Prisma migrations，再启动原 Next.js standalone 网站。失败时不启动；不执行开发 seed。

Build command：

```sh
corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm prisma:generate && node scripts/render-build.mjs
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
4. 仅在服务器秘密环境变量中设置 `DATABASE_URL` 和现有 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`。模型配置应沿用当前有效配置，不把密钥写入源码或聊天。三种签名/认证密钥使用不同随机值。
5. 新数据库不使用开发 seed。学生通过网页注册，首个管理员可用已有 `pnpm admin:create` 安全初始化，之后普通账号与教学管理仍在网页完成。参赛测试账号只提供学生权限，教师/管理员账号不公开。
6. 发布后检查 HTTPS、网页与静态资源、数据库、登录 Cookie、真实 AI 以及一次完整学习闭环；再用独立手机网络访问，检验休眠唤醒后的链接。

注册和部署已获用户授权。代理可以接续可用的浏览器登录会话操作平台；当前 GitHub 网页仍要求账号持有人输入密码，命令行凭据不能替代该网页身份验证。Render CLI 和 Neon CLI 已配置在 D 盘；登录凭据不会纳入仓库。

## 本轮验证与上线状态

本轮已运行 `pnpm lint`、`pnpm test`（最终全量复测 581 通过、8 个真实调用/可选测试跳过）、`pnpm build`；另用实际 Render 构建脚本完成 standalone 打包。新增草稿比赛开关后，环境/知识门禁定向复测 33/33 通过。Playwright 核心学习闭环在桌面和手机两种视口均通过（2/2）。一次未启动数据库的定向调用失败，随后改用项目隔离 PostgreSQL 包装器复测通过，不归为应用缺陷。

比赛配置的 standalone 冒烟检查 13/13 通过：5 个数据库迁移、启动不创建默认账号、网页与 10 个 JS/2 个图片资源、Mock/草稿说明、注册登录的安全 Cookie、创建学习、目标确认及诊断持久化。初次诊断请求漏了 v1.2 目标确认，被正确拒绝为 409；补齐前置事件后通过。此项采用本地 HTTP 和手动 HTTPS Origin/Cookie，仅证明部署包与应用行为，不等于公网 TLS 或真实 AI 验收。结果在本机 `.data/competition-validation/standalone-smoke.result.json`，不上传测试数据库或运行日志。

[比赛分支已推送至私有 GitHub 仓库](https://github.com/xjj235/ThinkTutor/tree/codex/free-competition-20260918)，从当前工作内容另建快照，保留原工作区的分支和未提交修改。只同步 Git 非忽略文件，不含 `.env`、本地数据库、上传文件、浏览器配置和 CLI 登录凭据；已扫描当前已知秘密值并核对复制文件的 SHA-256。该链接是源码分支，不是公网网站。

GitHub 命令行已登录并可访问私有仓库。Render/Neon 的官方 CLI 登录曾超时，尚不能据此声称已创建云服务；用户后续已授权代理自行注册/连接账号，剩余问题是可用登录通道。未取得真实公网 URL、数据库和真实 AI 联调证据前，状态只能称“部署准备完成”，不能称上线完成，也不应把 GitHub 分支链接当成网站链接。

登录恢复期间再次运行本地 lint、完整测试（581 通过、8 跳过）和构建，均通过。专用浏览器已能保持登录会话，但当前仍停在 GitHub 密码登录页；内置浏览器连接和已有 Chrome 自动连接均未提供可用登录状态。

GitHub Linux 检查第一次完整运行通过 lint、类型检查、测试和构建，浏览器测试为 66 通过、2 失败：教师作业测试只回答到证据问题刚被提出，就请求进入费曼讲解，被服务端正确拒绝。已补充具体证据回答并验证正常自动转阶段，未降低服务端门槛；本地该测试在桌面和手机视口复测 2/2 通过。修复后的完整云端检查以最新工作流结果为准。
