# ThinkTutor AI 行为契约

## Provider 接口

统一接口位于 `lib/ai/types.ts`：

```ts
interface AIProvider {
  createDiagnosticQuestion(...): Promise<...>;
  createCoachTurn(...): Promise<...>;
  createLearningReport(...): Promise<...>;
}
```

实现：

- `MockAIProvider`：默认开发、测试和无 API Key 演示。
- `OpenAIProvider`：真实 OpenAI Responses API 调用。

## 诊断问题

- 创建会话时生成一条诊断问题。
- 只问一个主要问题。
- 不提供标准答案。
- 目标是暴露学生已有理解和不确定处。

## 苏格拉底追问

支持问题类型：

- `CONCEPT_CLARIFICATION`
- `CAUSE_PROBE`
- `ASSUMPTION_TEST`
- `COUNTEREXAMPLE`
- `TRANSFER`
- `SCAFFOLDED_HINT`

规则：

- 每条 AI 回复只能包含一个主要问题。
- 不输出问题列表。
- 不直接输出完整答案。
- 最少完成 3 轮，最多完成 5 轮。
- 模型只能建议 `REQUEST_FEYNMAN`，最终状态转换由服务端决定。

## 连续“不知道”支持

服务端通过确定性规则识别低信息回答。

- 第一次：缩小问题范围。
- 第二次：提供线索或二选一框架。
- 第三次及以后：提供最小必要原理，但仍要求学生完成解释。

## 学习报告

报告五个维度：

- 概念完整度
- 逻辑完整度
- 表达清晰度
- 举例能力
- 迁移能力

每个维度必须包含：

- 0 到 100 整数分数。
- 学生回答中的具体证据。
- 一条具体反馈。

模型不得生成 `overallScore`。服务端对五维分数取算术平均并四舍五入。

如果没有证据展示某项能力，证据必须写：

```text
本次对话未充分展示
```

报告固定免责声明：

```text
本报告仅依据本次学习对话生成，属于形成性学习反馈，不代表标准化能力测评结果。
```

## OpenAI 模式安全约束

- 使用 OpenAI 官方 Node.js SDK。
- 使用 Responses API。
- 使用结构化输出。
- 使用 Zod 校验返回值。
- 设置请求超时。
- 处理网络错误、限流、无效输出和拒绝输出。
- 错误时不修改学习阶段。
- 不记录 API Key。
- 不把学生输入拼接成系统指令。
- 将学生输入和参考材料明确标记为不可信内容。

## Mock 模式

Mock Provider 确定性生成：

- 诊断问题。
- 苏格拉底追问。
- 支架提示。
- 五维学习报告。

它不使用随机数，保证单元测试、集成测试和 Playwright 测试可以在没有 API Key 的环境中完成完整闭环。
