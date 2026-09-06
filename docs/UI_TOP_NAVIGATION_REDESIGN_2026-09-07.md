# ThinkTutor 顶部工作台改版与检验

## 本轮范围

按用户最新要求，将全站左侧导航改为顶部导航，保留浅色专业工作台方向。
研习页原位于左侧的任务信息与阶段进度同步移至记录上方。
本轮是 UI 实施，不改变知识包、发布条件、服务端状态转换、评分或角色权限。
保留工作区原有未提交修改，不以旧报告或旧测试结果替代本轮检验。

## GitHub 研究

2026-09-06 至 09-07 查询官方仓库与示例，以下 Star 为页面显示的约数，会随时间变化。

| 项目 | Star | 借鉴范围 |
|---|---|---|
| [Tabler](https://github.com/tabler/tabler) | 41.6k | 品牌与账户栏、横向功能导航、共享内容基线 |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | 123.2k | 克制的控件外观与可访问组件原则 |
| [Ant Design Pro](https://github.com/ant-design/ant-design-pro) | 38.7k | 多角色工作台的信息组织与业务用语 |

主要视觉参考为 [Tabler 官方横向布局示例](https://preview.tabler.io/layout-horizontal.html)，已通过本地 Chrome 实际打开并截图检查。
不复制示例中的营销数据、图表、头像或商业指标；不引入 Bootstrap、Ant Design 或其他新 UI 依赖。
实现继续复用本项目的 Next.js、React、CSS 和 Lucide 图标。

## 实现

- 全站：顶部品牌及账户栏、横向角色导航，取消 body 左侧占位和固定侧栏。
- 手机：导航在顶部原位展开、推动下方内容，不设置左侧抽屉或模态遮罩；支持自然 Tab 顺序、Escape 关闭及焦点恢复。
- 学生、教师、管理员分别保留 6、5、7 个原有业务导航入口。个人资料与退出操作位于顶部，学习方法也可通过页脚“关于”访问。
- 研习：主题、目标、任务信息、阶段进度依次位于记录上方；阶段栏可键盘滚动，自动横向定位当前阶段，不强制改变页面纵向位置。
- 排版：普通页面最大 1240px、研习页 1080px、任务表单 960px，均居中；统计使用分隔线组织，取消浮动面板式统计外框。
- 文案：使用“研习进程与形成性评估”“已完成研习”“尚待验证的知识缺口”等明确表述；按钮保留直接动作，不改写学生原始证据或模型判断。
- 视觉：白色画布、浅灰导航带、青绿主操作、蓝色信息与琥珀色待巩固状态；保留公共入口真实场景图片。

## 当前检验

- `pnpm lint`：通过。
- `pnpm test`：251 项通过，3 项跳过；26 个测试文件通过，1 个实时模型测试文件跳过。
- `THINKTUTOR_DIST_DIR=.next/top-navigation-build pnpm build`：通过，TypeScript 与全部页面构建完成。
- 核心浏览器回归：28 项通过，包含桌面与手机端完整学习闭环、资料安全、角色权限、教学任务、材料管理、知识审核和顶部导航检查。
- v1.2 浏览器回归：18 项通过，包含桌面和手机端完整知识研习闭环及八案例矩阵；与核心回归合计 46 项通过。
- 响应式检查：学生、教师、管理员各检查 320、375、768、960、961、1024、1440、1920px，共 24 组；顶部布局、内容居中、导航数量和无横向溢出均通过。
- 已查看桌面/手机端总览、顶部展开菜单、研习、报告、任务表单与知识审核截图。机械检测发现顶部 3px 装饰线警告，已移除该装饰线。
- 首次核心回归为 26 通过、2 失败，失败均为本轮新增的“阶段处于屏幕内”断言；作答后正常纵向滚动不应被阶段切换打断，因此改为验证当前阶段完整处于横向进度栏内，再全量重跑得到上述 28 项通过。未为通过测试强制滚回页顶。

复跑基础命令（PowerShell，项目根目录）：

```powershell
pnpm lint
pnpm test
$env:THINKTUTOR_DIST_DIR='.next/top-navigation-build'
pnpm build
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:TEST_POSTGRES_PORT='55435'
pnpm e2e
```

本轮核心与 v1.2 按文件分批运行，输出分别为 `.local-preview/top-navigation/e2e-core-final` 与 `.local-preview/top-navigation/e2e-v12`；默认 `pnpm e2e` 会顺序运行这两组。

## 检验边界

本轮使用本地 Mock AI 与隔离 PostgreSQL 测试数据库，不调用付费模型。
测试截图中的用户、研习记录及评分仅为工程夹具，不代表真实学生表现或教师批准。
这不是阿里云上线、真实模型效果、Golden Set 或教师审核验收。
现有 pg 客户端并发查询弃用提示不属于本轮改版，未为此进行后端重构。

本地预览：[ThinkTutor](http://127.0.0.1:3102)，本轮最终存活检查 HTTP 200。
本轮截图与浏览器产物保存在 `.local-preview/top-navigation/`。
