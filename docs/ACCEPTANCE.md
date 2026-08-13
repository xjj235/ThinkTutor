# 生产验收标准

## 工程自动验收

- [x] pnpm frozen lockfile；
- [x] Prisma generate 与真实 PostgreSQL migration；
- [x] TypeScript strict、lint、unit/integration、production build；
- [x] Playwright 桌面 1440 类布局与 375×812 移动布局；
- [x] Mock 完整闭环、刷新持久化、AI 错误重试、重复请求去重；
- [x] Student A/B、Teacher A/B、Student/Teacher/Admin 角色边界和 Disabled User 自动测试。

## 产品验收

- [x] 学生注册、登录、自主学习、加入班级、教师任务、历史与学习档案；
- [x] 诊断 → 追问 → 费曼 → 报告 → 再练闭环；
- [x] 教师课程、章节、目标、材料、班级、任务和班级分析；
- [x] 管理员用户角色/状态、AI 使用、材料失败任务与关键操作审计页面；
- [x] 报告五维证据与服务端平均分；AI 失败不推进状态。

## 生产人工验收（未完成前不得勾选）

- [ ] 真实 DeepSeek API smoke test；
- [ ] 阿里云 RDS migration 与旧数据归属确认；
- [ ] Tair、private OSS、RAM Role、ECS/Nginx 实机验证；
- [ ] 域名、DNS、SSL 与适用备案；
- [ ] RDS 恢复演练、告警和回滚演练；
- [ ] 隐私政策、用户协议、未成年人条款法律审核。
