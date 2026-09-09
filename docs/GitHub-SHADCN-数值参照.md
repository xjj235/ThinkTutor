# GitHub 数值参照：shadcn/ui

日期：2026-09-09。唯一视觉基准为 shadcn/ui 的 new-york-v4，不再混合 LobeChat、Linear 或其他设计语言。

## 可核验来源

固定源码版本：`3ba91b1cc83e1bbe4ab35a422ff2a694849c5048`。许可证为 MIT，署名保存在根目录 `THIRD_PARTY_NOTICES.md`。

| 来源 | 读取到的规则/数值 | ThinkTutor 落点与明确偏差 |
| --- | --- | --- |
| [globals.css](https://github.com/shadcn-ui/ui/blob/3ba91b1cc83e1bbe4ab35a422ff2a694849c5048/apps/v4/app/globals.css) | background/card/foreground/primary/muted/border/input/ring 成对语义；中性暗色背景 `.145`、面板 `.205`、muted `.269`、文字 `.985`；基础圆角 `.625rem` | `tokens.css`：暗色近似 sRGB `#0a0a0a/#171717/#262626/#fafafa`；控制圆角 6px，面板 8px。没有照搬 10px+，遵守现有圆角上限；浅色卡面改为 `#fdfdfd`，避免纯白直出。 |
| [button.tsx](https://github.com/shadcn-ui/ui/blob/3ba91b1cc83e1bbe4ab35a422ff2a694849c5048/apps/v4/registry/new-york-v4/ui/button.tsx) | gap 8px、字重 500、默认高 36px、横向内边距 16px；主按钮实心，次按钮中性底，危险动作独立语义；focus ring 3px | `.button` 保留 8/16/500；中文正文 16px、按钮 48px、图标命中区 44px；focus 改为不裁切的 2px outline + 3px offset；disabled 用配对 token，而非透明度叠加。 |
| [input.tsx](https://github.com/shadcn-ui/ui/blob/3ba91b1cc83e1bbe4ab35a422ff2a694849c5048/apps/v4/registry/new-york-v4/ui/input.tsx) | 高 36px，横向 12px，细边框和极轻阴影；移动端 16px，桌面 14px | 输入框统一 48px/16px；学习长文本 18px；边框单独加深到 `#888888`，以满足 3:1 控件识别要求。 |
| [card.tsx](https://github.com/shadcn-ui/ui/blob/3ba91b1cc83e1bbe4ab35a422ff2a694849c5048/apps/v4/registry/new-york-v4/ui/card.tsx) | 垂直/水平内边距 24px、内容间距 24px、轻阴影 | 仅统计项、课程项、维度项等重复条目使用卡片；表单段落与报告主体保持无框。卡片 24px，手机部分 16px。 |
| [table.tsx](https://github.com/shadcn-ui/ui/blob/3ba91b1cc83e1bbe4ab35a422ff2a694849c5048/apps/v4/registry/new-york-v4/ui/table.tsx) | 表头高 40px、内边距 8px、底部分割线、muted hover | 列表按 40px 图标 / 弹性正文 / 112px 状态 / 20px 箭头栅格；列表正文 16px，辅助 14px；数据表内边距 12px/16px。 |
| [empty.tsx](https://github.com/shadcn-ui/ui/blob/3ba91b1cc83e1bbe4ab35a422ff2a694849c5048/apps/v4/registry/new-york-v4/ui/empty.tsx) | 内边距 24px/48px，分组 gap 24px，标题 18px，图标容器 40px | `EmptyState` 使用 40px 图标、18px 标题、16px 可读说明；`WorkspaceState` 为加载、失败、404 提供独立标题、恢复动作与状态播报。 |
| [fonts.ts](https://github.com/shadcn-ui/ui/blob/3ba91b1cc83e1bbe4ab35a422ff2a694849c5048/apps/v4/lib/fonts.ts) | 使用 Geist/Geist Mono，字体变量由 next/font 统一注入 | 不照搬字体下载。使用本机系统无衬线栈，中文 Microsoft YaHei/PingFang SC；本轮 CDP 确认 Windows 标题及正文实际渲染 Microsoft YaHei。 |
| [dashboard/page.tsx](https://github.com/shadcn-ui/ui/blob/3ba91b1cc83e1bbe4ab35a422ff2a694849c5048/apps/v4/app/(app)/examples/dashboard/page.tsx) | 16/24px 内容间距，紧凑头部，统一数据展示区 | 顶部 72px 品牌栏 + 48px 导航，内容最大宽 1280px；没有搬运其侧栏，遵守用户顶部导航要求。 |

## 对照规则

- 五档实际字号：14 / 16 / 18 / 20 / 32px，不随视口连续缩放。400 正文、500 标签和动作、600 标题。
- 常用空间：4 / 8 / 12 / 16 / 24 / 32 / 48px。正文行高 1.75，学习文本 1.777778，最大行宽 44em。
- 一套中性表面、正文和边界，加一个品牌青绿；危险红和警告色仅表示状态，不参与装饰。
- 180ms hover/focus/active 色彩变化；没有上浮导致的位移；系统减少动态效果时关闭过渡。
- 暗色由同一语义变量切换，默认浅色；偏好保存在浏览器，不改变服务器模型配置。
- [WCAG 2.2 文本对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)：普通文字 4.5:1，大字 3:1；不能把圆整后的 4.49 当作通过。

## 分层实施范围

| 层级 | 文件 | 效果 | 风险与功能影响 |
| --- | --- | --- | --- |
| L1 样式体系 | `src/app/tokens.css`, `globals.css`, `workspace.css`, `public/icons/*` | 统一五档字级、灰阶、间距、边框、状态与阅读排版 | 低至中。全局选择器影响广，需要全角色、移动端与暗色回归；不改业务规则。 |
| L2 结构与状态 | `site-navigation.tsx`, `theme-toggle.tsx`, `workspace-state.tsx`, `session-client.tsx`, `report-client.tsx`, `task-form.tsx`, `app/{loading,error,not-found}.tsx` | 顶部布局不变，加入主题开关；学习消息身份结构、报告层级和可恢复状态 | 中。保留事件处理、键盘路径、数据访问；新增外观偏好是客户端表现状态。 |
| L3 品牌表现 | 无额外高风险改造 | 保留问思学伴品牌与现有本地图片 | 未引入外部字体、背景资源、重型组件库或角色装饰。 |
