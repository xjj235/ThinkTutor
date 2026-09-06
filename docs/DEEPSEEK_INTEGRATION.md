# DeepSeek V4 Flash 接入

入口为 `src/lib/ai/deepseek-provider.ts`，服务端直接调用 `${DEEPSEEK_BASE_URL}/chat/completions`。生产启动契约：`AI_PROVIDER=deepseek`、`DEEPSEEK_MODEL=deepseek-v4-flash`、有效 `DEEPSEEK_API_KEY`。

当 `DEEPSEEK_WEB_SEARCH_FALLBACK=true` 时，诊断和追问改用 `${DEEPSEEK_BASE_URL}/responses`，强制 `tool_choice: { type: "web_search" }`，要求模型返回结构化 JSON 与 `webSources`。如果课程知识库命中，模型需要对比 `retrievedContext`、教师材料和网页结果：一致处合并，差异处按学习目标、材料时效、来源权威性和学生当前任务校准后再输出；如果课程知识库未命中，网页作为主要外部依据。网页来源只保存到消息 metadata 并展示在 HTML 对话中；它不能作为学生掌握证据，也不能写入报告评分依据。

自动测试通过 mock fetch 验证模型名、JSON Output、thinking 开关、Prompt 边界、Zod 二次校验、429 与无效输出。真实 API 测试会产生费用且需要负责人提供密钥，因此默认不运行；上线前由负责人在隔离环境设置 `DEEPSEEK_LIVE_TEST=true` 后执行 smoke test，并核对控制台用量。不得把测试 Key 写入仓库或 CI。

报告和复杂摘要启用 thinking；教学追问关闭 thinking 以降低延迟。任何内部推理字段均不进入数据库或客户端。
