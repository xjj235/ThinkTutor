# ThinkTutor 浏览器与 HTML 访问说明

ThinkTutor 已按标准 Web 应用交付。用户不需要安装 Node.js、pnpm、数据库或查看源码；部署负责人启动服务器后，用户只需在 Chrome、Edge、Safari 或 Firefox 中输入网址。Next.js 在服务器端返回 `text/html`，浏览器随后调用同源 API 完成登录、学习对话、报告和教学管理。

## 为什么不是单个 HTML 文件

本项目包含登录、权限、PostgreSQL 持久化、服务端学习状态机、AI Provider、限流和审计。这些能力不能安全地放入一个可以复制的静态 HTML 文件：否则数据库凭据和 AI Key 会泄露，也无法可靠保持用户状态。因此正确形态是“浏览器访问 HTML 页面 + 服务器处理 API 和数据”，这也是本地、局域网和阿里云生产共用的方式。

## 一、仅在当前电脑查看

部署负责人执行：

```powershell
pnpm install --frozen-lockfile
pnpm preview
```

用户在同一台电脑访问：

```text
http://127.0.0.1:3100
```

默认只监听本机回环地址，其他电脑无法访问。

## 二、让同一局域网用户访问

在作为临时服务器的电脑上执行：

```powershell
pnpm preview:lan
```

终端会打印类似以下地址：

```text
http://192.168.1.20:3100
```

同一可信 Wi-Fi 或局域网中的用户直接在浏览器访问该地址。若操作系统防火墙拦截，可只为“专用网络”入站开放 TCP 3100；不要向公网路由器映射该端口。局域网预览包含演示账号且使用 HTTP，仅用于验收和展示，不用于真实学生数据。

存在多张网卡或自动选择的地址不可达时，可指定用户实际访问的主机名或 IPv4：

```powershell
$env:PREVIEW_PUBLIC_HOST="192.168.1.20"
pnpm preview:lan
```

`APP_URL` 会自动与该地址保持一致，保证登录和同源写请求能够通过安全校验。

## 三、阿里云上线后让互联网用户访问

生产拓扑为：

```text
用户浏览器 → HTTPS 域名 → ECS Nginx → Next.js Web → RDS / Tair / OSS / DeepSeek
```

上线负责人完成以下工作：

1. 准备 ECS、RDS PostgreSQL、Tair Redis、private OSS、域名和证书；
2. 把 `.env.production.example` 复制为不入库的 `.env.production`，填写真实服务端配置；
3. 将 `APP_URL` 设置为最终 HTTPS 域名，例如 `https://learn.example.com`；
4. 构建并启动 `docker-compose.production.yml` 中的 Web 与 Worker；
5. 将 Nginx 示例配置中的域名和证书路径替换为实际值；
6. 公网只开放 80/443，容器 3000、RDS 和 Tair 均不得直接暴露；
7. 运行 migration、健康检查和三个角色的权限 smoke test。

完成后，普通用户只需访问：

```text
https://你的正式域名
```

生产环境不会显示本地演示账号，API Key、数据库连接和 OSS 凭据也不会进入 HTML 或浏览器 JavaScript。

完整云部署步骤见 [ALIYUN_DEPLOYMENT.md](./ALIYUN_DEPLOYMENT.md)。

## 四、HTML 访问验收

可通过响应头验证首页确实以 HTML 提供：

```powershell
(Invoke-WebRequest http://127.0.0.1:3100).Headers["Content-Type"]
```

预期包含：

```text
text/html
```

项目的 Playwright 冒烟测试也会验证首页状态码、`Content-Type: text/html`、桌面/移动布局、登录和完整业务闭环。
