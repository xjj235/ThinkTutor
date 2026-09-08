# 提问与反馈的知识库接入修正

日期：2026-09-07。代码基线：`2469474`。本轮针对提问与反馈，不调整总览布局或评分门槛。

## 本轮定位

- 只读核查本地预览数据：截图对应的三次“解释风险传播路径”会话，其 `knowledgeRuntime` 均为空，实际使用通用 Mock 提问。
- 原匹配逻辑只检查任务标题，忽略已由服务端解析的章节“系统性风险”和学习目标。
- v1.2 原有回复主要呈现下一道题，缺少对本轮作答证据和缺项的明确反馈。
- 诊断提示缺少同知识单元的分层回退；结构化检索传入的知识单元内容仅为摘要。

## 实施内容

- `src/lib/knowledge/releases.ts`：结合标题、章节和目标匹配知识包，保留草案开关与生产发布门槛，不从学生回答或参考材料推断知识版本。
- `src/lib/session-service.ts`：课程目标和作业先经过服务端授权与内容解析，再匹配知识包；再练以原始任务主题匹配，避免被改写后的标题带离原主题。
- `src/lib/retrieval/knowledge-retriever.ts`：已锁定的允许版本可用于通用标题检索；传入完整知识单元内容，保留数量预算和教师资源过滤。
- `src/lib/knowledge/turn-feedback.ts`：根据本轮已校验的原文引用与当前证据规则，呈现相关依据、具体缺项或待核验判断。限制引文长度并转义学生 Markdown，不直接授予稳定掌握。
- `src/lib/knowledge/v12-engine.ts`：提示优先匹配当前题目，再回退至相同目标的已发布题目及对应提示等级。
- `src/lib/knowledge/v12-session-service.ts`：反馈与下一问共同保存并通过 Zod 校验。评估题干来自题库或服务端阶段提示，不将含学生引文的旧反馈作为锁定题干。重复提交与刷新沿用已保存的消息。

## 本轮验证

| 检查 | 最终结果 |
| --- | --- |
| `pnpm lint` | 通过，零 lint 警告 |
| `pnpm test` | 263 通过，3 项真实 DeepSeek smoke 按配置跳过 |
| `pnpm build` | 通过，使用独立 `.next/grounded-feedback-build` 输出目录 |
| `pnpm typecheck --incremental false` | 移除本轮临时类型路径后通过 |
| 浏览器基础流程 | 本轮完整 `pnpm e2e` 的 core 批次 28 项通过 |
| 八案例矩阵 | 同轮桌面与手机各 8 项通过，共 16 项 |
| `pnpm e2e e2e/knowledge-runtime.spec.ts` | 最后重跑 4 项全部通过，包括课程目标接入及完整知识库闭环，覆盖桌面与手机 |

浏览器去重覆盖共 48 项，来自本轮上述批次，不引用历史 CI。桌面和手机的 `grounded-feedback.png` 已目视检查，新增反馈完整换行，页面横向溢出断言通过。

复现使用 pnpm、Mock 和独立临时 PostgreSQL。浏览器使用已安装 Chrome：`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe`，E2E 数据库端口为 `55435`。本机 pnpm 报告现有 `allowBuilds` 配置差异，命令设置进程级 `pnpm_config_verify_deps_before_run=warn`，没有重装依赖或修改锁文件。

本轮发现并修正的测试问题：新增浏览器用例最初漏选学习者水平，随后误以为学生接口应暴露内部版本；现已补齐 HTML 操作，并从测试数据库核验版本。重复完整单元测试还发现新课程夹具影响后续清理，现已按 ID 清理新用例自己的课程数据。上表列出修正后的结果，首次完整 E2E 命令并非一次全绿。

## 保留边界

- 不改写原有三次会话、学生作答或历史报告；从“自主研习”新建，或从已完成报告发起再练，才会使用新的匹配逻辑。
- 保留本轮开始时 `next-env.d.ts` 和 `tsconfig.json` 已有的预览配置，仅移除本轮构建与 E2E 加入的路径。
- 本地预览仍为 `http://127.0.0.1:3102/`，测试未使用其持久化数据库。
- 本轮属于本地 Mock 工程验证，不代表真实模型教学效果、教师审核、Golden Set 签署或生产云验收；没有切换真实 AI，也没有发布知识包。
- 本轮更改未提交或推送 GitHub。
