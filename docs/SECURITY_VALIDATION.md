# 用户数据、课程知识库与 DeepSeek 密钥隔离验证

验证日期：2026-08-13。本文记录代码级和自动化验证结果，不把尚未创建的阿里云资源描述为已验证。

## 安全边界

| 数据 | 浏览器可见范围 | 服务端边界 | 外部 DeepSeek |
|---|---|---|---|
| 用户账号 | 当前用户公开资料；教师仅在所管班级查看必要成员信息 | Cookie 为 HttpOnly；密码仅存 Argon2 哈希；查询按角色、所有权或成员关系过滤 | 不发送姓名、邮箱、原始 userId、sessionId、requestId；只发送不可逆匿名 user 标签 |
| 学习会话 | 只返回学习所需 DTO；不返回 userId、课程外键、referenceText、learnerState 或消息 metadata | 学生只能操作本人会话；任课教师仅能读取自己任务的会话；管理员按角色授权 | 只发送当前学习任务所需的题目、近期对话和有限检索片段 |
| 课程知识库 | 学生没有材料/片段 API；教师只管理本人课程；材料 DTO 不返回 objectKey、上传者、哈希和内部失败详情 | 私有 OSS 或本地受签名存储；随机对象键；课程级检索；上传完成后二次校验 | 只发送已授权会话检索到的有限片段；材料视为不可信内容，不能覆盖系统规则 |
| DeepSeek Key | 永不进入 HTML、JSON、Client Component 或 `NEXT_PUBLIC_*` | 仅 `server-only` Provider 从 `DEEPSEEK_API_KEY` 读取并放入服务端 Authorization Header | 作为 HTTPS Authorization Header 发给 DeepSeek，不写日志、不写数据库 |

## 已实施控制

1. API 和页面授权全部在服务端执行；客户端传入的用户、课程、班级和阶段信息不被信任。
2. 浏览器 DTO 使用字段白名单；敏感响应统一 `Cache-Control: private, no-store` 与 `Vary: Cookie`。
3. 学生班级响应不含加入码、同班成员和草稿任务；课程响应不含 ownerId；任务响应不含 createdById 等内部外键。
4. 材料对象键为不可关联用户身份的 UUID；本地签名使用独立 `STORAGE_SIGNING_SECRET`，不复用认证密钥。
5. DeepSeek 请求移除 `userId`、`sessionId`、`requestId`；供应商侧用户标签由独立 `AI_PSEUDONYM_SECRET` 执行 HMAC 派生，不能从内部 ID 直接复算。
6. 应用拒绝 `NEXT_PUBLIC_DEEPSEEK_API_KEY`、`NEXT_PUBLIC_DATABASE_URL` 等危险环境变量；`.env*` 默认被 Git 和 Docker 构建上下文排除，仅保留示例文件。
7. 日志只记录错误类型与机器码，不记录异常 message、stack、cause、请求正文、参考材料或供应商响应；Prisma 生产自动错误日志关闭。
8. 全站设置 CSP、禁止 iframe、MIME 嗅探、无 Referrer 和最小浏览器权限；Nginx 强制 TLS 1.2/1.3、HSTS 并隐藏版本。
9. RDS 运行账号与迁移账号分离；Web/Worker 只持有最小 DML 权限，DDL 凭据只进入一次性 migration 容器。
10. 生产只允许 RDS/Tair/OSS 私网或私有访问；公网仅开放 Nginx 80/443，Next.js 3000 只绑定回环地址。

## 实际攻击与回归验证

- 跨学生读取他人会话：403。
- 教师读取其他教师课程/材料：403。
- 学生班级 API 搜索加入码、同学邮箱、教师草稿：均不存在。
- 会话创建响应搜索私有 referenceText、userId、learnerState：均不存在。
- 伪造、过期或方法不匹配的本地存储签名：拒绝。
- DeepSeek 捕获请求体搜索原始 userId：不存在；模型配置与 API Key 仅服务端读取。
- `NEXT_PUBLIC_*` 密钥注入：应用拒绝启动，错误信息只含变量名、不含值。
- 异常对象携带数据库 URL、Token、学生正文或 DeepSeek Key：日志归一化结果不含这些值。
- HTML 响应检查 CSP、`nosniff`、`DENY`、`no-referrer`；API 检查 `no-store`。
- 生产构建使用密钥哨兵值，扫描 `.next/static` 和完整 `.next`；哨兵不得出现。
- 源码与跟踪文件扫描真实 Key 模式、`NEXT_PUBLIC_*` Secret、`dangerouslySetInnerHTML` 与 `any`。

## 阿里云上线前必须现场复核

代码无法证明尚未创建的云资源配置。上线负责人必须在真实账号中验证：RDS/Tair 无公网地址或公网白名单为空；OSS Bucket 为 private、CORS 仅正式 Origin、服务端加密和版本控制开启；ECS RAM Role 策略仅允许指定 Bucket 前缀；Secrets 文件权限和轮换生效；Nginx 证书链、HSTS 与公网端口扫描通过；DeepSeek Key 为独立生产 Key，并在泄漏演练中可立即吊销。

## 已知限制

- 应用层授权不是 PostgreSQL Row-Level Security；数据库凭据一旦被窃取仍可访问其授权范围，因此必须使用私网、最小权限、凭据轮换与 RDS 审计。
- DeepSeek 为完成功能会接收最小化后的学习文本与检索片段；若业务要求材料绝不离开自有云，需要改用受控私有模型部署，不能仅靠前端隐藏实现。
- CSP 为兼容 Next.js 当前运行方式允许同源内联脚本；它仍阻断第三方脚本、对象、iframe 与任意外连，但后续可评估 nonce 化进一步收紧。
- 管理员按产品职责可访问全局运营数据；管理员账号必须使用独立强认证、最少人数和审计，未来应增加 MFA。
