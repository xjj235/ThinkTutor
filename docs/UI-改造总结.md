# ThinkTutor UI 改造总结

日期：2026-09-09。方向：浅色专业学习工作台、顶部导航、中文阅读优先。

## 1. 结果与入口

本轮完成现状勘察、源码研究、分层方案、四个独立L1提交、反馈组件与用语优化、前后截图和重新验证。没有改变学习状态机、知识包、评分、API或真实模型配置。

- [本地应用](http://127.0.0.1:3102)：同一套Next.js应用，当前健康检查为ready/database ok/aiProvider deepseek。
- [前后截图对照页](<D:/Codex/New project/.local-preview/ui-audit-2026-09-09/对照.html>)：10组、20张实际截图；已验证图片全部加载。
- [改造前审计](<D:/Codex/New project/docs/UI-审计报告.md>)。
- [GitHub参照与数值规则](<D:/Codex/New project/docs/GitHub-参照与可搬运规则.md>)。
- [实施前分层方案与复核追加项](<D:/Codex/New project/docs/UI-分层改造方案.md>)。

## 2. 审美判据与评分

判断本质：优先级清楚，空间和排版有秩序，交互状态可信，持续阅读不费力。1=阻碍、2=明显缺陷、3=可用但不一致、4=成熟且有实证、5=本次范围内突出。评分为工程证据支持的设计判断，不是用户研究或WCAG认证。

| 判据 | 前 | 后 | 本轮可验证变化 |
|---|---:|---:|---|
| 层级 | 4 | 4 | 保留单一主动作与顶部阶段；删除按指标序号分配的装饰性颜色，状态色只承担信息用途。 |
| 对齐与栅格 | 3 | 5 | 总览列表表头/内容起点桌面均149、手机均81px；手机顶栏/正文均16px；首统计项不再被旧选择器挤偏。 |
| 间距与留白 | 3 | 4 | 4/8基准变量替换零散间距，字段/组/章节节奏清晰；任务课程区上移约32px而不缩小文字。 |
| 字体排版 | 4 | 4 | 正文16、对话18保留；错误反馈13.76升至16；输入值400与标签600分开；实际字体为Microsoft YaHei。 |
| 色彩 | 3 | 4 | 近白画布、灰阶分组与一个青绿品牌强调；关键文本抽样最低4.6478升至5.0234:1；输入边界1.5049升至3.2478:1。 |
| 一致性 | 3 | 4 | 根主题数值统一到tokens.css，标签/控件/表面圆角4/6/8；仍保留部分历史选择器，不宣称全部组件已重写。 |
| 状态完整性 | 3 | 4 | 状态图标、16px反馈、稳定禁用、重试恢复、焦点、空态均验证；原生危险确认取消后PATCH数0。 |
| 动效 | 3 | 4 | 常规色彩180ms、输入背景220ms，按下不位移；减少动态偏好下过渡为0，加载图标停止旋转但状态文案保留。 |
| 克制 | 5 | 5 | 无新增大依赖、装饰图、侧栏、营销模块或嵌套卡片；现有真实学习场景图继续使用。 |
| 细节质感 | 3 | 4 | 阅读区预留滚动条位置、行焦点不被边界裁掉；移除本地开发徽标对手机提交按钮的遮挡。 |
| 总分 | **34/50** | **42/50** | 7项提升、3项保持；没有为抬分而把已良好的排版判为低分。 |

## 3. 参照与取舍

主选是 [Radix spacing](https://github.com/radix-ui/themes/blob/main/packages/radix-ui-themes/src/styles/tokens/space.css) 的尺度、[Primer border/radius](https://github.com/primer/css/blob/main/src/support/variables/misc.scss) 的边界，以及AI对话应用的作者/内容/状态分组。

研究清单：shadcn/ui、Radix Themes、Mantine、daisyUI、Ant Design、Primer CSS、Carbon；LobeHub（原lobe-chat）、Open WebUI、Chatbot UI、Dify；Vercel Platforms、Geist UI、cmdk的Linear/Raycast示例；Refactoring UI公开目录、Laws of UX、WCAG。

没有照抄英文后台常见的12–14px正文、32–36px控件或聊天侧栏。所有规则对应的具体源码、数值、使用位置、Stars核验范围及许可证记录在参照文档中。无第三方代码/图片/字体复制，无新安装依赖，无运行时外网字体。

## 4. 文件与Token对照

| 文件 | 变化 |
|---|---|
| [tokens.css](<D:/Codex/New project/src/app/tokens.css>) | 唯一主题数值来源：颜色、空间、字号、行高、圆角、尺寸、动效。 |
| [globals.css](<D:/Codex/New project/src/app/globals.css>) | 保留语义别名，移除重复色值；基础样式引用token，取消按钮位移和全局0.01ms覆盖。 |
| [workspace.css](<D:/Codex/New project/src/app/workspace.css>) | 统一栅格/边距/阅读节奏，收敛重复视觉尺度，完善控件和反馈状态。 |
| [layout.tsx](<D:/Codex/New project/src/app/layout.tsx>) | 载入统一tokens，不改导航和路由。 |
| [async-feedback.tsx](<D:/Codex/New project/src/components/async-feedback.tsx>) | 既有Lucide状态/重试图标，保留aria-live、role和重试行为。 |
| [新建课程页](<D:/Codex/New project/src/app/teacher/courses/new/page.tsx>) | “先建立…之后再…”改为“课程范围、适用对象与教学定位。”；字段与命令不变。 |
| [next.config.ts](<D:/Codex/New project/next.config.ts>) | `devIndicators:false`关闭开发徽标；不关闭控制台错误、异常检测或业务校验。 |
| [ui-design-audit.spec.ts](<D:/Codex/New project/preview-e2e/ui-design-audit.spec.ts>) / [ui-readability.spec.ts](<D:/Codex/New project/preview-e2e/ui-readability.spec.ts>) | 当前截图、对比度、实际字体、焦点、布局、放大、原生确认与错误数检查。 |
| DESIGN.md / MASTER.md | 同步新的设计来源、规则与验收边界。 |

| 变量或实测属性 | 原值 | 新值 |
|---|---|---|
| --canvas | #ffffff | #fafbfc |
| --paper | #ffffff | #fdfefe |
| --paper-subtle | #f7f8fa | #f1f3f5 |
| --ink | #24282f | #252a31 |
| --ink-soft | #616975 | #525e6b |
| --ink-faint | #68717e | #5e6976 |
| --line | #e6e8ec | #dce1e6 |
| --line-strong | #ced3da | #858f9b |
| --teal | #16776a | 不变，品牌连续性 |
| 字号/行高 | 正文16/27.2，对话18/34.2 | 正文16/28，对话18/32 |
| 错误反馈 | 13.76px | 16px |
| 控件输入字重 | 继承标签600 | 400 |
| 圆角 | 4/5/6/7/8等分散字面值 | --radius-tag=4、control=6、surface=8 |
| --space-1…9 | 无共享空间变量 | 4/8/12/16/24/32/40/48/64px；row=20、reading=28 |
| --page-gutter | 手机顶栏14、正文18 | 手机16、平板24、桌面32，居中上限仍保留 |
| --control-height / --icon-target | 48 / 44px散落定义 | 48 / 44px集中定义，长内容允许增高 |
| --motion-fast / --motion-normal | 100/160/180ms分散 | 180 / 220ms，统一ease-out |
| 低动态模式 | 全局transition 0.01ms | 控件transition:none，状态文字保留 |

中性色分背景、文字、边界三组；青绿是品牌强调。蓝色信息、琥珀警示和红色错误属于功能语义，不作为装饰配色。整体仍是浅色，不变成单色青绿页面。

## 5. 本轮验证

| 验证 | 最终结果 | 证据/范围 |
|---|---|---|
| pnpm lint | 通过，0 errors / 0 warnings | 全仓ESLint；临时迁移脚本也改用ESM后重跑。 |
| pnpm test | 321通过、3跳过 | 35文件通过、1文件跳过；隔离PostgreSQL，未将Mock故障测试日志当成真实模型失败。 |
| pnpm build | 通过 | 独立`.next/ui-audit-build`，TypeScript通过，52个静态生成项；未占用预览缓存。 |
| 本地UI检查 | 14/14通过 | 37页面×1440桌面/375手机，外加768表单、CSS zoom=2、焦点/按下/状态/确认。 |
| 普通核心闭环 | 14/14通过 | thinktutor-flow、workspace-design、teacher-assignment-flow、admin-user-management、resilience双视口。 |
| v1.2专项闭环 | 4/4通过 | knowledge-runtime双视口，包含有依据反馈、案例迁移、版本化报告。 |
| 浏览器控制台 | 0 | 8份全页面runtime-errors.json合计0，关键状态审计正常流程额外两份也为0。503故障注入单独标记。 |
| 对比度探针 | 通过 | 关键固色文本最低5.0234:1，输入边界最低3.2478:1；不将四舍五入用于通过判定。 |
| 对照页 | 20/20图片加载 | comparison-check.json；公共图片亦通过naturalWidth检查。 |
| 机械设计扫描 | 0条 | impeccable detect输出`[]`；不能替代视觉审阅或全站无障碍认证。 |
| 预览健康 | ready / database ok / deepseek | 本轮`/api/health/ready`；Redis未配置，不能视作生产基础设施验收。 |

首次把resilience与knowledge-runtime显式混跑时12通过、4失败。启动器会因knowledge-runtime文件将整组设置为v1.2，旧测试未确认学习目标就等待作答/提交答案，产生等待超时或409。分为普通模式14项和v1.2模式4项重跑后全部通过；未改产品逻辑，也未删除失败断言。完整初次失败产物仍在`core-loop`。

最初审计测试的定位器/截图光标问题也保留在本地历史产物；最终产物另存，未覆盖失败记录。pnpm依赖状态提示、pg并发query弃用提示属于既有工具链警告；本轮不进行无关依赖升级。

### 复现命令

在项目目录PowerShell运行：

```powershell
$env:pnpm_config_verify_deps_before_run='warn'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:PREVIEW_BASE_URL='http://127.0.0.1:3102'
pnpm lint
$env:TEST_POSTGRES_PORT='55436'
pnpm test
$env:THINKTUTOR_DIST_DIR='.next/ui-audit-build'
pnpm build
pnpm preview:check preview-e2e/ui-design-audit.spec.ts preview-e2e/ui-readability.spec.ts --output=.local-preview/ui-audit-2026-09-09/recheck-ui
$env:TEST_POSTGRES_PORT='55435'
pnpm e2e e2e/thinktutor-flow.spec.ts e2e/workspace-design.spec.ts e2e/teacher-assignment-flow.spec.ts e2e/admin-user-management.spec.ts e2e/resilience.spec.ts --output=.local-preview/ui-audit-2026-09-09/recheck-core
pnpm e2e e2e/knowledge-runtime.spec.ts --output=.local-preview/ui-audit-2026-09-09/recheck-v12
```

两个e2e命令不可合并为一次显式文件调用。构建/E2E自动产生的tsconfig/next-env缓存路径已恢复为本轮开始前内容，避免提交环境噪声。

### 截图索引

根目录：`D:/Codex/New project/.local-preview/ui-audit-2026-09-09/`。

- before：本轮基线公共页、列表、表单、会话、报告、教师/管理页。
- before-states-final：基线焦点、系统暗色偏好、错误、加载/禁用。
- after-release：最终37页面与交互状态；其中audit.json、runtime-errors.json、native-dialog.json为测量证据。
- core-final：普通闭环、实际新账号空态及键盘导航。
- v12-final：知识反馈、案例迁移与版本报告。
- 对照.html：8组学习页面及2组错误反馈的前后并排对照。

本轮截图与测量包含本地账号/学习内容，仅保留本机，Git忽略。所有新演练数据来自隔离测试数据库；预览故障测试拦截请求、不保存课程。

## 6. 提交与回滚

分支：`codex/ui-evidence-refinement`。本轮只创建本地提交，未push。

| 提交 | 内容 |
|---|---|
| ce91877 | 用户要求的现状安全基线，保留原有60个改动文件；不等于对全部历史改动验收 |
| 8b430a6 | 审计、GitHub参照、分层方案与审计脚本 |
| 4aa067b | L1-A：语义颜色/圆角token |
| f36c620 | L1-B：栅格与阅读节奏 |
| 88e4871 | L1-C：交互状态 |
| 511da6d | L2：反馈分层及状态验证 |
| cdaed6f | L1-D：输入字重与预览遮挡修正 |
| 5ad0ce7 | 课程设定用语校准 |

单项撤销可用`git revert <commit>`，保留历史。整体撤销本轮UI时按从新到旧撤销基线之后的提交；不要撤销`ce91877`，它保存的是用户此前工作。后续状态样式依赖tokens，单独撤销较早token提交可能需要处理后续依赖，不能承诺任意顺序零冲突。密钥、env和本地数据库始终未提交。

## 7. 边界与下一轮

现有应用没有暗色主题或自定义HTML模态框。系统暗色偏好下维持浅色的行为未降低；原生确认只验证取消和无写入，不冒充自定义弹窗截图。低动态、移动导航、错误恢复均保留。

本轮不是教学效果/真实模型评分一致性/教师审核/生产云验收。普通测试与v1.2专项使用Mock保证流程可重复；本地预览继续使用真实DeepSeek配置，但没有将本轮UI验证说成新的模型质量验收。

下一轮优先：用教师与学生真实长文本做可用性访谈，观察连续10分钟阅读和作答的负担；逐页将仍在TSX中的历史颜色类替换为语义组件；随后再单独评估完整暗色主题和自定义危险确认。品牌图片与字体不是当前最优先的投入。
