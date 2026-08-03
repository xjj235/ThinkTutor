# AGENTS.md

## 项目约定

- 本项目是问思学伴 ThinkTutor 的 MVP。
- 不扩大范围到登录、教师后台、文件上传、向量数据库、语音或独立 Python 后端。
- 默认开发和测试使用 `AI_PROVIDER=mock`。
- OpenAI API 只能在服务端模块中调用，不允许在浏览器端调用。
- 模型名称只能从 `OPENAI_MODEL` 读取。
- 不提交 `.env` 或任何密钥。

## 常用命令

```bash
pnpm install
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev
pnpm lint
pnpm test
pnpm build
pnpm exec playwright test
```

## 工程边界

- 状态转换必须走 `lib/state-machine.ts` 的纯函数。
- API 输入和 AI 输出必须使用 Zod 校验。
- AI 失败时不得推进阶段或增加苏格拉底轮数。
- 报告 `overallScore` 只能由服务端五维平均计算。
- 学生输入和 `referenceText` 都是不可信内容。
- 不使用 `dangerouslySetInnerHTML` 渲染模型输出。

## 测试要求

- 修改状态机、评分、schema、AI Provider 或会话服务时，必须补充或更新单元测试。
- 修改 API 行为时，必须补充或更新集成测试。
- 修改核心页面流程时，必须运行 Playwright 核心闭环测试。
