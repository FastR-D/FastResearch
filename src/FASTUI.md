# Research UI

统一目标来自根 `FASTUI-PACKAGE-CONTRACT.md`：Write/Task 蓝灰工作台，浅色主操作 `#155fb8`、深色 `#0e639c`，正文/背景/焦点/状态取自发布 token；布局、个人 Key、工作流、今日任务和收件箱结构保留。

`@fastrd/ui-foundation` 和 `@fastrd/ui-react` 正式依赖精确固定官方 npm `0.1.2`，锁文件记录官方 tarball URL 与完整性；`main.tsx` 导入发布样式，`color-mode.ts` 创建唯一 foundation controller，沿用同源 News 已使用的 `fastresearch-theme`。React 用 `useSyncExternalStore` 读取解析结果，按钮调用 controller，旧组件不再另写 storage/主题状态。初始化先于 React mount；无存储时仍可切换。

`index.css` 是唯一工作台宿主样式：一个 root 语义映射消费 FastUI，保留布局、响应式、业务状态和插图。旧 SoftUI/console 色板、neo 变量、各套 html.dark 外观与旧遮罩已删除；不再加载覆盖文件。Tailwind 保留既有 base reset；当前入口不使用旧 App.tsx 的 utilities，因此不输出该历史页面的工具类色板。`promo.css` 只由 main 导入一次，保留自己的局部语义。包不包含 Research 的品牌素材、文案、账号或私有数据。

`/intro` 保留既有浅色宣传页，通过局部 `data-fastui-theme=light` 消费同一套品牌 token；它没有颜色模式按钮，不覆盖工作台已保存的颜色偏好。

浏览器回归：构建后 `npm run test:fastui -- /path/to/chromium /path/to/evidence`。脚本启动真实 Node server 和临时 SQLite/roster，覆盖深浅色、三视口、长 Key 列表、native dialog 键盘/焦点、roster 实际保存、成员工作流/信箱及 intro；不使用生产数据。
