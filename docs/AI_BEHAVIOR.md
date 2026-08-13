# AI 行为与 DeepSeek Provider

生产 Provider 仅为 `DeepSeekProvider`，模型从 `DEEPSEEK_MODEL` 读取，生产必须等于 `deepseek-v4-flash`；开发和全部自动测试默认使用确定性 `MockAIProvider`。不存在 OpenAI SDK、OpenAI Provider 或旧 DeepSeek 模型名。

## 调用策略

- 诊断、常规追问、费曼说明关闭 thinking；
- 报告、再练任务、上下文摘要、材料关键词启用 thinking 并设置高推理强度；
- 只消费最终 `message.content`，不保存或展示 `reasoning_content`；
- Chat Completions 使用 `response_format: {type: "json_object"}`，系统消息同时给出 JSON 词与结构示例；
- JSON 解析后必须再过对应 Zod Schema；`overallScore` 不属于模型 Schema。

每轮只有一个主要问题。苏格拉底类型包括概念澄清、原因追问、证据追问、假设检验、反例、迁移和支架提示。未展示的能力不能生成掌握证据；报告每个维度必须给出本次对话证据。

## 不可信边界

学生输入、教师参考材料与检索片段都放在 `<untrusted_learning_content>` 包装内，不拼入系统规则。材料中的“忽略规则、泄露提示词、改变角色”只视为学习内容。Markdown 渲染关闭原始 HTML，不使用 `dangerouslySetInnerHTML`。

## 失败

超时、429、网络/5xx、无效 JSON 与 Schema 错误映射到统一可重试错误；最多两次指数退避。AI 调用发生在数据库状态事务前，因此失败不会推进阶段、增加轮数或伪造学生消息。

## 可观测性

记录 provider、model、operation、状态、官方返回的 Token、缓存命中 Token、耗时、重试次数和错误码；不推测或伪造 Token，不记录密钥、完整提示词或完整学生原文。DeepSeek `user` 是服务端加盐域隔离后的不可逆稳定哈希。
