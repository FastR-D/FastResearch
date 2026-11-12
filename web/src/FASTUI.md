# Research UI / FastUI 0.3.0

`@fastrd/ui-foundation` 与 `@fastrd/ui-react` 精确固定官方 npm `0.3.0`，不使用相邻源码或本地 link 作为运行依赖。`vite.config.ts` 使用 UnoCSS，`uno.config.ts` 配置 `presetFastUI()` 与 `fastUIContent`，入口只加载一次 `virtual:uno.css`。保留现有 Tailwind base reset，不重复导入全量控件样式。

`color-mode.ts` 创建唯一 foundation controller，沿用 `fastresearch-theme`。React 用 `useSyncExternalStore` 读取结果，初始化先于 mount。产品页通过局部 `data-fastui-theme="light"` 使用浅色，不改写工作台偏好。

工作台位于 `/workspace`，使用 Button、TextField、Dialog 与 SegmentedControl；宿主 `index.css` 组织业务布局与响应式，不带 footer。个人 Key、管理员、FastCAS、分发名册、工作流、今日任务和信箱沿用现有 API。`?tool=fast-read` 直接选中工具，`?view=insight` 直接打开信箱。

产品总页位于 `/`，各应用介绍位于 `/intro/短名称`。`PromoPage.tsx`、`JourneyTrail.tsx` 与 `use-screen-journey.ts` 提供中文整屏切换与连续缓弯路线；品牌叙事、线路、产品截图与内容属于 Research，自身不受组件库封装范围限制。`products.ts` 维护应用内容和入口，`copy.ts` 维护工作台中文，不包含 i18n。

当前页面结构与浏览器验收命令见 `docs/FASTRESEARCH-STYLE.md`。早期 `FASTRESEARCH-PROMO-PAGE.md` 为历史规划，当前路由和内容以现行规范及实现为准。
