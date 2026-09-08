# ThinkTutor UI 审计报告

日期：2026-09-09。改造前基线：`ce91877`；分支：`codex/ui-evidence-refinement`。

## 1. 判断框架

好看是信息优先级、空间秩序与操作可信度的共同结果，不是装饰数量。评价面向需要连续阅读、解释和查证的中文学习工作台。

评分锚点：1=阻碍使用；2=明显缺陷；3=可用但存在不一致；4=成熟且主要场景有证据；5=在本次检查范围内表现突出。视觉评分属于设计判断，不是自动化测试结论，也不等于正式 WCAG 认证。

| 项目 | 分数 | 本轮代码或截图证据 |
|---|---:|---|
| 层级 | 4 | 总览 H1 32px、主按钮 48px，学习阶段位于记录上方；统计指标同时使用三种强调色，主次仍可收敛。 |
| 对齐与栅格 | 3 | 桌面导航与总览都起于 x=60；列表标题起点未让出图标列。375px 下顶栏 x=14、正文 x=18，首统计项 padding-left=24，而其他项为14。 |
| 间距与留白 | 3 | `workspace.css` 同时有9/10/13/14/18/22/26px等间距；表单顶部说明和课程关联之间空隙较大；组件内和组件间节奏不统一。 |
| 字体排版 | 4 | 本轮实测正文16、对话18、桌面标题32、手机28，已有中文系统字体栈；但 `.async-feedback` 仍为13.76px，辅助信息有15/14混用。不会为了模仿英文后台缩小中文正文。 |
| 色彩 | 3 | 关键页面固色文本抽样最低4.6478:1，无已测文本低于AA阈值；输入边框 `#ced3da` 对白底约1.50:1，控件边界较弱。背景仍为纯白；蓝色被用于按序号区分指标和进度条，而非意义。 |
| 一致性 | 3 | `globals.css` 与 `workspace.css` 各有一组同名根变量，圆角4/5/6/7/8px散布；共享尺度之外仍有历史覆盖。 |
| 状态完整性 | 3 | 已有焦点、主按钮反馈、禁用、空态、错误和重试；错误反馈无图标，禁用主要依赖透明度，图标按钮缺少统一按下态。故障注入确认输入未丢失且提交恢复可用。 |
| 动效 | 3 | 按钮分别为180/180/100ms，导航160ms，未统一token；低动态偏好通过全局0.01ms覆盖，状态不应依赖位移。 |
| 克制 | 5 | 顶部工作台、学习记录和证据报告，无营销卡片堆叠；公共入口保留既有实景学习图片，无新增装饰需求。 |
| 细节质感 | 3 | 滚动条已有着色；表头、统计首列、错误反馈和边框仍有细小但可见的不一致。 |
| 合计 | **34/50** | 本轮改造从已完成的阅读性优化继续，不把历史页面当作本轮基线。 |

## 2. 项目与入口

- 类型：Web 应用，Next.js App Router、React、Tailwind CSS、Lucide 图标。不是桌面皮肤或静态演示。
- 入口：`src/app/layout.tsx`，依次导入 `globals.css`、`workspace.css`、KaTeX。
- 当前主题：两份 CSS 根变量；设计约束在 `DESIGN.md` 与 `design-system/thinktutor/MASTER.md`。
- 布局：`site-navigation.tsx`、`page-shell.tsx`；内容：`task-form.tsx`、`session-client.tsx`、`report-client.tsx`、`teacher-forms.tsx`。
- 状态：`async-feedback.tsx`、`account-security.tsx`、`admin-user-actions.tsx`。
- 无应用内暗色模式，`color-scheme: light`；操作系统暗色偏好下仍为浅色。此次保留该行为，不宣称实现暗色主题。
- 无自定义 HTML 弹窗；管理员危险变更使用 `window.confirm`。浏览器原生弹窗不属于页面截图内容，记录为“不适用”，不伪造弹窗截图。

## 3. 本轮改造前实证

预览：[http://127.0.0.1:3102](http://127.0.0.1:3102)。`GET /api/health` 返回 `ok:true`。使用正在运行的真实模型预览，只读页面检查不会调用模型或改写学生记录。

- `ui-readability.spec.ts`：8项通过，37个实际页面×桌面1440×900、移动375×812；覆盖公共入口、登录、列表、表单、会话、报告、教师与管理页面，无页面横向溢出。
- `ui-design-audit.spec.ts`：最终4项通过，补测键盘焦点、系统暗色偏好、低动态偏好、768px表单、禁用提交与错误反馈。
- 普通关键页面巡检记录浏览器错误数0（桌面、移动各0）；故障注入的503单独归类，不能算成自然运行错误。
- 测试脚本最初使用带必填标记的精确标签造成等待，已改为稳定ID。第二次截图隐藏光标引发移动端水合警告，已使用 `caret: initial` 避免截图工具改写输入元素；最终重跑通过，未压制应用错误。
- 本轮未修改知识库、评分、API、数据库或模型配置。历史模型质量验证不纳入本报告。

### 截图与测量索引

本机产物根目录：`D:/Codex/New project/.local-preview/ui-audit-2026-09-09/`，因包含本地账户和学习记录而不提交到Git。

| 场景 | 根目录下相对位置 |
|---|---|
| 公共首页、登录、说明页 | `before/ui-readability-public-*/` |
| 总览、列表、任务表单、会话、报告 | `before/ui-readability-student-*/` |
| 教师课程、班级、知识审核、表单 | `before/ui-readability-teacher-*/` |
| 管理员列表与系统页 | `before/ui-readability-admin-*/` |
| 焦点、系统暗色偏好、平板表单与测量 | `before-states-final/ui-design-audit-key-*/` |
| 加载、禁用与错误状态 | `before-states-final/ui-design-audit-loading-*/` |

[桌面总览](<D:/Codex/New project/.local-preview/ui-audit-2026-09-09/before/ui-readability-student-pag-142e8-and-preserve-top-navigation-preview-desktop/_dashboard.png>) · [手机总览](<D:/Codex/New project/.local-preview/ui-audit-2026-09-09/before/ui-readability-student-pag-142e8-and-preserve-top-navigation-preview-mobile/_dashboard.png>) · [任务表单](<D:/Codex/New project/.local-preview/ui-audit-2026-09-09/before/ui-readability-student-pag-142e8-and-preserve-top-navigation-preview-desktop/_learn_new.png>)。

对比度探针计算固色文本和祖先背景合成色，排除图片文字、隐藏和禁用元素；不覆盖抗锯齿像素、所有图表、复杂透明叠层，因此不作全站AA认证。
