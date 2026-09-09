# GitHub 参照与可搬运规则

> 本文为前一轮多仓库调研记录。当前唯一视觉基准已收敛为shadcn/ui new-york-v4固定源码版本，实际数值及项目偏差见[GitHub-SHADCN-数值参照.md](GitHub-SHADCN-数值参照.md)。不再混用下文其他产品的视觉语言。

研究日期：2026-09-09。方法：GitHub仓库元数据、实际源码、维护者文档交叉核查。Stars只表示关注度，不代表适合中文学习工作台。

## 选择结论

选用 **Radix 的空间尺度 + Primer 的克制边界 + AI 对话产品的阅读层级**。保留 ThinkTutor 的顶部导航和中文阅读字号，不移植后台框架、不加入左侧栏、不复制品牌素材。不新增运行时网络字体或依赖。

GitHub API本轮返回：shadcn/ui **123,377**、Ant Design **99,438**、daisyUI **42,329**、Mantine **31,690**、Primer CSS **13,015**、Carbon **9,441**、Radix Themes **8,676** stars。其后匿名接口受限，其他仓库不编造精确收藏数；cmdk仓库页面显示约13.0k。计数会变化。

## 源码到本项目

以下数值是检查到的源码值；“采用”列明确区分原值和针对ThinkTutor的自主选择。链接指向本次读取的分支文件，后续上游更新可能改变内容。

| 参照与来源 | 客观做法或数值 | ThinkTutor采用位置与取舍 |
|---|---|---|
| [shadcn-ui/ui Button](https://github.com/shadcn-ui/ui/blob/main/apps/v4/public/r/styles/default/button.json) | 默认/次要/危险/轮廓分开；默认40px、大44px；图标不收缩；焦点环2px且偏移2px。 | 共享button明确主/次/危险态，图标不压缩；本项目坚持48px主控件、44px图标，不降低字号和触控尺寸。 |
| [Radix spacing源码](https://github.com/radix-ui/themes/blob/main/packages/radix-ui-themes/src/styles/tokens/space.css) | 九级4/8/12/16/24/32/40/48/64px，统一CSS变量。 | 新 `tokens.css` 使用同一九级；补20/28px项目尺度，分别用于行内留白与阅读记录。导航、表单、列表共享引用。 |
| [Radix typography](https://www.radix-ui.com/themes/docs/theme/typography) | 正文16/24px；18/26与20/28是独立梯度；系统字体栈。 | UI正文16/28，对话18/32、章节20/28、H1桌面32/44与手机28/40。中文长句增加行高；不采用负字距，不下载字体。 |
| [Mantine default-theme](https://github.com/mantinedev/mantine/blob/master/packages/@mantine/core/src/core/MantineProvider/default-theme.ts) | 字号12/14/16/18/20；标题字重700；间距10/12/16/20/32，圆角2/4/8/16/32。默认并非所有可访问选项自动开启。 | 学习内容与操作标签分层，反馈正文也提升至16；仅取字号组织法，不照抄10px间距和大圆角，不把库默认值视作AA证明。 |
| [daisyUI light tokens](https://github.com/saadeghi/daisyui/blob/master/packages/daisyui/src/themes/light.css) | 每种背景有对应content前景；field圆角0.25rem、box0.5rem，尺寸与圆角分离。 | primary/on-primary与danger/danger-soft成对；状态色与边框色分开，禁止靠整体opacity处理可读的禁用标签。 |
| [Ant Design seed](https://github.com/ant-design/ant-design/blob/master/components/theme/themes/seed.ts) | sizeUnit=4，圆角6，默认字号14、控件32；motionUnit=.1，easeOut为(.215,.61,.355,1)。 | 采用6px控件圆角及自然ease-out；统一180ms色彩反馈、220ms较慢反馈；不采用32px高控件或14px中文正文。 |
| [Primer misc变量](https://github.com/primer/css/blob/main/src/support/variables/misc.scss) | 边框1px、圆角4/6/8；tooltip宽上限250px，delay=.4s。 | 标签4、控件6、真正有边界的记录/列表8；提示不遮挡核心内容。布局分隔线与控件边框使用不同token。 |
| [Carbon layout源码](https://github.com/carbon-design-system/carbon/blob/main/packages/layout/src/index.ts) | 8px miniUnit派生间距；spacing01至13用0.25/0.5/1/1.5/2/3/4等倍数；布局断点含672/1056/1312px。 | 区分间距、控件尺寸和布局断点，不机械把1px边框及6px圆角四舍五入；继续沿用项目700/960/1180断点避免大规模重排。 |
| [LobeHub DESIGN](https://github.com/lobehub/lobehub/blob/canary/DESIGN.md) | lobe-chat现重定向lobehub；组内8、组间16、章节24–32；语义颜色，正文14、强调16，控件36。 | 元数据与对话分组，作者/阶段/问题类型保持明确；采用组间规律，不采用小字号或通用聊天侧栏。 |
| [Open WebUI Messages](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/Messages.svelte) 与 [ResponseMessage](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/Messages/ResponseMessage.svelte) | 对话有语义section标题；加载标签与消息分离；响应内容局部使用0.9375rem及leading-relaxed。 | 保留现有学习阶段和记录语义，16px反馈独立区域，对话18px/32px；不改自动滚动/消息逻辑。 |
| [Chatbot UI message](https://github.com/mckaywrigley/chatbot-ui/blob/main/components/messages/message.tsx) | 消息宽度550/650/700px按断点约束，移动p-6，作者与内容分层。 | 对话使用最长约44em中文阅读行宽，居中于记录区域；不把全文拉到1320px，不照抄气泡形状。 |
| [Dify light](https://github.com/langgenius/dify/blob/main/web/themes/manual-light.css)、[dark](https://github.com/langgenius/dify/blob/main/web/themes/manual-dark.css) | 同一color-chat-bubble-bg在light使用白色，dark使用rgb(42,43,48)至(37,38,42)，按语义换值而非全屏反相。 | token命名与颜色定义分離；本轮不新增暗色功能。后续可换token并逐页审查硬编码，不复制它的渐变。 |
| [Vercel platforms globals](https://github.com/vercel/platforms/blob/main/app/globals.css) | `--radius=.625rem`，派生减4/减2/加4px；sans/mono别名独立。 | 字体、圆角统一入口；项目圆角上限8px。未查到仓库根许可证，禁止移植其代码或图片。 |
| [Geist UI shared](https://github.com/geist-org/geist-ui/blob/master/components/themes/presets/shared.ts) | unit16px、radius6px、pageWidth750pt；字体与断点集中。 | 延续1320px工作区、1160px学习页、1080px任务页，尺寸集中命名。不将pt原值误当px。 |
| [cmdk Raycast示例](https://github.com/dip/cmdk/blob/main/website/styles/cmdk/raycast.scss) 与 [Linear示例](https://github.com/dip/cmdk/blob/main/website/styles/cmdk/linear.scss) | Raycast选项40px、Linear选项48px，均有150ms状态过渡；列表高度受限。 | 只学习固定控件尺寸和选中/聚焦区分；不新增命令面板，也不采用transition:all。Arc复刻不再叠加研究，顶部工作台不需要浏览器壳。 |

## 方法论转译

- [Refactoring UI官方公开目录](https://refactoringui.com/)强调层级、字号体系、行长与空态。转译：每个操作区域仅一个主动作，次要动作用轮廓或链接；标题前留白大于标题后。具体16/24/32数值是本项目选择，不能归称为书中规定。
- [Law of Proximity](https://lawsofux.com/law-of-proximity/)：相关信息靠近。转译：字段标签到控件8px，同组字段24px，组间32px；错误信息紧邻当前表单。
- [WCAG 2.2文本对比](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)：常规文字4.5:1，大字3:1；不能将4.499四舍五入为通过。[非文本对比](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)用于核查必要控件边界和焦点的3:1；灰线仅作为布局分隔不等同输入边界。
- 暗色不等于一律“降饱和”：应成对定义背景/前景和状态，逐一复核对比度。LobeHub暗色部分状态更明亮，说明不能机械套用单一公式。

## 许可证与署名边界

本轮没有复制仓库代码、图片、字体或品牌资产，全部CSS和组件由本项目自行实现；以上链接构成研究署名。未安装以上组件库。

- MIT：shadcn/ui、Radix、Mantine、daisyUI、Ant Design、Primer（本轮API核验）；Chatbot UI、Geist UI、cmdk（本轮LICENSE/仓库页面核验）。
- Carbon：Apache-2.0（API核验）。
- [LobeHub LICENSE](https://github.com/lobehub/lobehub/blob/canary/LICENSE)：Community License；[Open WebUI LICENSE](https://github.com/open-webui/open-webui/blob/main/LICENSE)：项目自定义许可；[Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE)：附加条件的Apache派生许可。不能把这些仓库当作无条件MIT模板复制。
- Vercel Platforms：本轮根目录LICENSE请求未成功，许可未确认，不复制。

上述是本次材料使用记录，不是针对未来商业衍生使用的法律意见。
