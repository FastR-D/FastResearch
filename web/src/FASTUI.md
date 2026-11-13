# Research UI / FastUI 0.3.0

`@fastrd/ui-foundation` 与 `@fastrd/ui-react` 精确固定官方 npm `0.3.0`，不使用相邻源码或本地 link 作为运行依赖。`vite.config.ts` 使用 UnoCSS，`uno.config.ts` 配置 `presetUno()`、`presetFastUI()` 与 `fastUIContent`，入口只加载一次 `virtual:uno.css`。`styles/index.css` 仅保留 Tailwind base reset，不重复导入全量控件样式。

`color-mode.ts` 创建唯一 foundation controller，沿用 `fastresearch-theme`。React 用 `useSyncExternalStore` 读取结果，初始化先于 mount。产品页通过局部 `data-fastui-theme="light"` 使用浅色，不改写工作台偏好。

## Workspace

工作台位于 `/workspace`。框架、工具页、个人动态、今日任务、信箱、团队进度、Key / FastCAS 登录、管理账号和分发设置统一使用 FastUI 组件及官方 `fastui-*` HTML 类：

- 控件使用 Button、TextField、TextArea；弹窗使用原生 FastUI Dialog，标题栏使用紧凑的 PanelHeader，正文保留 modal-body 结构与独立的舒适触摸密度。
- 内容使用 Section、PanelHeader、Toolbar、ListRow、Divider；提示、状态、空内容和加载使用 Alert、Badge、EmptyState、Loading。
- 进度使用原生 `progress.fastui-progress`，链接使用 `fastui-link` 或官方按钮样式类。
- 颜色、字体、圆角、边框、焦点、交互状态和触摸密度由 FastUI 提供。不得添加工作台专用 CSS、内联样式、自定义色板、控件覆盖规则或自定义动画。
- UnoCSS 标准工具类仅组织布局、间距、宽度、响应式排列、内容换行、滚动和标题层次；根容器的字体与页面颜色直接引用 FastUI token，正文使用 14px 字号和宽松行距。不重新定义组件视觉样式。

没有工作台专用样式表或 footer。参考 FastWrite 的全高工作区：根容器占满 `100dvh`，顶栏不收缩，其余高度交给左右布局；桌面侧栏宽 256px、撑满剩余高度，管理入口靠底，侧栏与主内容分别滚动。导航采用官方 `data-fastui-density="touch"`，行高至少 44px，标签为 14px；分组、卡片、列表与正文增加留白，通过共享 `PanelBody`、`PanelHeading` 和 `PanelRow` 组织。

模态框标题栏使用原生 FastUI PanelHeader，桌面约 38px；触摸端保留可用的关闭按钮尺寸。标题栏保持在滚动区域顶部，正文表单使用舒适密度，不跟随标题栏压缩。

已登录且当前应用入口已配置时，隐藏该应用的宣传标题、介绍、能力要点、使用步骤、介绍页链接和通用认证说明，仅保留应用跳转按钮与联动信息。未登录或应用未部署时继续显示介绍和配置说明。

移动端由菜单按钮展开有高度限制的可滚动导航，Escape 收起；选择页面后聚焦主内容并复位主区域滚动。`?tool=fast-read` 选中工具，`?view=today|insight|team` 打开辅助页面，支持刷新、前进和返回。个人 Key、管理员、FastCAS、分发名册和信箱保留认证边界；应用动态与任务统一读取 `/api/workspace/apps/{id}/activity`。目录的 `capabilities` 控制动态和任务展示，`AppTasksPanel` 不包含 FastTask 专用 API。工具标题和进入按钮同排，统计块统一左侧标签、右侧大号粗体蓝色数字。CAS 会话在到期前自动续签，保留工具、视图和任务应用选择。

## 产品页

产品总页位于 `/`，各应用介绍位于 `/intro/短名称`。`PromoPage.tsx` 按需加载 `styles/promo.css`，工作台不加载宣传页 CSS。`JourneyTrail.tsx` 与 `use-screen-journey.ts` 提供中文整屏切换与连续缓弯路线；品牌叙事、线路、产品截图与内容属于 Research。`products.ts` 维护应用内容和入口，`copy.ts` 维护工作台中文，不包含 i18n。

当前页面结构与浏览器验收命令见 `docs/FASTRESEARCH-STYLE.md`。早期 `FASTRESEARCH-PROMO-PAGE.md` 为历史规划，当前路由和内容以现行规范及实现为准。
