# 安全基线

详细的威胁边界、攻击验证和阿里云上线复核项见 [SECURITY_VALIDATION.md](SECURITY_VALIDATION.md)。

- Zod 验证全部 JSON、动态参数和分页；统一错误响应带 requestId；
- 写请求执行同源检查，Cookie 为 SameSite；登录、注册、AI 有 Redis 限流；
- 所有资源在服务端做 RBAC + ownership/membership，防止 IDOR；
- `clientRequestId`、数据库唯一键、乐观版本、Serializable 事务和 Redis 短锁防重放与并发重复；
- 文件 Key 使用随机 UUID，路径白名单与 resolved-path containment 防穿越，Worker 校验魔数；
- 学生与材料内容按不可信边界传入 AI，模型输出关闭 HTML 渲染；
- Pino 对 authorization、cookie、password、token、API Key 等字段脱敏；异常只记录类型和机器码，不记录 message、stack 或 cause；
- Secret 只在服务端环境变量，不允许 `NEXT_PUBLIC_*` Key，不提交 `.env`、证书或私钥。
- 浏览器 DTO 使用字段白名单，不返回 referenceText、learnerState、objectKey、内部所有权外键或材料哈希；
- RDS 常驻应用账号与一次性 migration 账号分离，Web/Worker 不持有 DDL 凭据。

生产网络：仅 80/443 公网，22 仅固定管理 IP；3000、RDS 5432、Tair 6379 不开放公网。RDS/Tair/OSS/ECS 同地域 VPC，最小权限 RAM Role。上线仍需外部渗透测试、依赖扫描和法律审核。
