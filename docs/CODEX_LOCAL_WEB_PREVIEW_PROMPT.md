# ThinkTutor 本地成果网页实施提示词

下面的提示词可直接交给 Codex，用于复现或继续维护本地成果预览能力。当前仓库已经按照这份提示词完成实现。

```text
你是 ThinkTutor 项目的首席全栈工程师、产品设计工程师和测试负责人。

项目目录：D:\Codex\New project

开始前必须完整阅读：
- AGENTS.md
- README.md
- package.json
- prisma.config.ts
- prisma/schema.prisma
- prisma/seed.ts
- src/app 下全部页面与 Route Handlers
- src/components 下全部组件
- src/lib 下认证、权限、状态机、AI、存储、检索和数据库实现
- scripts/with-test-postgres.ts
- playwright.config.ts 与 e2e 目录
- docs/ARCHITECTURE.md
- docs/ALIYUN_DEPLOYMENT.md
- docs/FINAL_PRODUCTION_REVIEW.md

目标：
在不创建第二套假演示站、不绕过真实 API、不退回 SQLite 的前提下，让用户只执行一个 pnpm 命令，就能在本机浏览器查看 ThinkTutor 的真实成果；同一套 Next.js 页面、Prisma 模型、API、认证、状态机和组件必须可以直接用于阿里云 ECS + RDS + Tair + OSS + DeepSeek 部署。

必须完成：
1. 新增 `pnpm preview`。
2. 该命令自动启动工作区内持久化 PostgreSQL，不要求用户预装 Docker 或系统 PostgreSQL。
3. 数据存放在 gitignore 的 `.local-preview/`，停止后保留，下次可恢复。
4. 自动执行 Prisma production migration。
5. 自动执行幂等 development seed。
6. Seed 提供学生、教师、管理员三个角色，以及课程、章节、目标、班级和已发布任务。
7. 本地预览固定使用 `AI_PROVIDER=mock` 和本地签名存储，不产生 AI 费用。
8. 启动后在终端明确打印网页 URL、三个账号、统一密码、数据位置和停止方式。
8.1 默认只允许本机浏览器访问；另提供显式的局域网启动命令，监听 `0.0.0.0`，打印可供用户输入的局域网 URL，并让 `APP_URL` 与该 URL 的 Origin 一致。
9. 首页必须成为真正的成果入口，而不是只有一个标题和按钮：
   - 清晰解释产品定位；
   - 展示诊断、追问、费曼、报告四阶段；
   - 展示学生、教师、管理员三个入口；
   - 解释五维报告的证据原则；
   - 本地模式显示演示账号；
   - 生产模式绝不显示演示账号和密码。
10. 页面保持中文、白色背景、低饱和蓝绿色教育风格。
11. 不使用强渐变、玻璃拟态、无意义动画或通用聊天软件布局。
12. 桌面 1440px 和移动 375px 都不能横向溢出。
13. 所有交互必须键盘可用，链接、按钮和表单必须有可访问名称。
14. 不使用 `dangerouslySetInnerHTML`、`any`、npm/yarn 或额外 UI 库。
15. 不在首页伪造静态学习分数、报告或学生掌握证据。
16. 本地预览只能改变基础设施配置和本地提示，不得复制或分叉业务逻辑。
17. 阿里云生产继续使用：
   - `DEPLOYMENT_ENV=production`
   - PostgreSQL/RDS
   - Redis/Tair
   - private OSS
   - `AI_PROVIDER=deepseek`
   - `DEEPSEEK_MODEL=deepseek-v4-flash`
   - Nginx HTTPS 域名向用户提供 HTML，并反向代理到内部 Next.js 3000 端口
18. 更新 README，优先展示一键预览命令，同时保留 Docker 开发和阿里云生产启动说明。
19. 新增一份本提示词文档，方便后续 Codex 复用。

安全要求：
- 演示账号只允许在 development seed 中创建。
- 生产环境禁止 seed。
- 本地预览密码可以打印，但不得复用为生产 Secret。
- 数据库目录必须经过绝对路径边界校验。
- 子进程参数不得接受 shell 元字符注入。
- Ctrl+C 必须同时停止 Next.js 和嵌入式 PostgreSQL。
- 局域网预览必须明确警告仅限可信网络；不得把开发演示账号或 HTTP 预览作为公网生产方案。
- 不记录 API Key、Cookie、Token 或真实学生输入。

验证要求：
1. 实际执行 `pnpm preview`。
2. 在真实 Chromium/Chrome 中打开首页。
2.1 验证首页响应状态为 200 且 `Content-Type` 包含 `text/html`。
3. 验证页面标题、四阶段、三角色、本地账号区域可见。
4. 使用学生账号登录，确认 dashboard 和教师任务可见。
5. 使用教师账号登录，确认教师工作台、课程、班级和任务可见。
6. 使用管理员账号登录，确认系统管理入口可见。
7. 分别检查 1440×900 和 375×812，无横向溢出。
8. 运行 `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm e2e`。
9. 不删除测试、不降低断言、不通过跳过规避失败。

最终报告必须包含：
- 本地网页地址；
- 一键启动命令；
- 演示账号；
- 本地与阿里云如何共用代码；
- 修改/新增文件；
- 实际执行命令；
- 测试数量与结果；
- 未验证的真实云资源和 DeepSeek 限制。
```
