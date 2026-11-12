# Research UI / FastUI 0.3.0

`@fastrd/ui-foundation` 与 `@fastrd/ui-react` 精确固定官方 npm `0.3.0`，不使用相邻源码或本地 link 作为运行依赖。`vite.config.ts` 使用 UnoCSS，`uno.config.ts` 配置 `presetUno()`、`presetFastUI()` 与 `fastUIContent`，入口只加载一次 `virtual:uno.css`。`styles/index.css` 仅保留 Tailwind base reset，不重复导入全量控件样式。

`color-mode.ts` 创建唯一 foundation controller，沿用 `fastresearch-theme`。React 用 `useSyncExternalStore` 读取结果，初始化先于 mount。产品页通过局部 `data-fastui-theme="light"` 使用浅色，不改写工作台偏好。

## Workspace

工作台位于 `/workspace`。框架、工具页、个人动态、今日任务、信箱、团队进度、Key / FastCAS 登录、管理账号和分发设置统一使用 FastUI 组件及官方 `fastui-*` HTML 类：

- 控件使用 Button、TextField、TextArea；弹窗使用原生 FastUI Dialog，按标准 header / modal-body 结构组织。
- 内容使用 Section、PanelHeader、Toolbar、ListRow、Divider；提示、状态、空内容和加载使用 Alert、Badge、EmptyState、Loading。
- 进度使用原生 `progress.fastui-progress`，链接使用 `fastui-link` 或官方按钮样式类。
- 颜色、字体、圆角、边框、焦点、交互状态和触摸密度由 FastUI 提供。不得添加工作台专用 CSS、内联样式、自定义色板、控件覆盖规则或自定义动画。
- UnoCSS 标准工具类仅组织布局、间距、宽度、响应式排列、内容换行、滚动和标题层次；根容器的字体、字号及页面颜色直接引用 FastUI token。不重新定义组件视觉样式。

没有工作台专用样式表或 footer。移动端由菜单按钮展开导航，Escape 收起；选择页面后聚焦主内容。`?tool=fast-read` 选中工具，`?view=today|insight|team` 打开辅助页面，支持刷新、前进和返回。个人 Key、管理员、FastCAS、分发名册、今日任务和信箱沿用现有 API。

## 产品页

产品总页位于 `/`，各应用介绍位于 `/intro/短名称`。`PromoPage.tsx` 按需加载 `styles/promo.css`，工作台不加载宣传页 CSS。`JourneyTrail.tsx` 与 `use-screen-journey.ts` 提供中文整屏切换与连续缓弯路线；品牌叙事、线路、产品截图与内容属于 Research。`products.ts` 维护应用内容和入口，`copy.ts` 维护工作台中文，不包含 i18n。

当前页面结构与浏览器验收命令见 `docs/FASTRESEARCH-STYLE.md`。早期 `FASTRESEARCH-PROMO-PAGE.md` 为历史规划，当前路由和内容以现行规范及实现为准。
