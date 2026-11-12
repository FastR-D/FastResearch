# FastResearch 页面与视觉规范

## 页面体系

- `/`：FastResearch 总产品页。即使已有成员会话，也默认展示产品内容。
- `/intro/news`、`/intro/read`、`/intro/write`、`/intro/ppt`、`/intro/lab`、`/intro/task`、`/intro/insight`、`/intro/figure`、`/intro/cas`、`/intro/ui`：各应用介绍。路径使用不带 fast 的短名称。
- `/workspace`：左侧工具导航，右侧展示所选工具的简介、能力要点、进入按钮与介绍页链接。今日任务、信箱、团队进度与管理功能放入侧栏，移除 footer。
- `/intro` 兼容跳回 `/`，旧 `/fastppt` 页面跳转至 `/intro/ppt`；旧图片资产仍可访问。
- 根路径的 FastCAS 回调、FastTask 登录参数与既有工作台锚点继续进入 `/workspace`。不迁移到 console。

## 中文内容

页面只使用中文，不提供语言切换，也不读取旧语言偏好。`web/src/shared/copy.ts` 是工作台中文文案与变量替换，不包含语言、翻译或持久化机制。应用介绍内容集中在 `web/src/shared/products.ts`，总产品路线在 `web/src/pages/promo/PromoPage.tsx` 中组织。

## 视觉与交互

设计沿用 [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) 的可访问性、React 与滚动建议，并以用户指定的蓝色节点路线为核心。底层使用 FastUI 0.3.0 的颜色、主题和控件。

- 一条蓝色缓弯曲线贯穿整个屏幕，每屏仅保留一段主路线。屏间连线放在视口外，避免重复线条。光点沿连续路线与切屏同步移动，节点对应当前章节。
- 右侧章节导航沿纵向节点推进；章节名称与位置不只依赖颜色表达。
- 产品总页六屏：起点、发现、研读、表达、推进、开始。各应用四屏：概览、能力、路径、开始。
- 滚轮、触控滑动和 PageUp / PageDown 每次推进或后退一屏。专用控制器拦截惯性尾段，不累计跳屏；一屏为 Sticky 顶栏下方的完整可视区域。普通切屏约 620ms，使用平缓的正弦缓动。Home / End 和章节链接可直达。
- 产品页和工作台使用通栏 Sticky 顶栏，高约 54–56px，无外圆角、外阴影或悬浮间距；内部内容居中排列。
- Workspace 顶栏仅放了解 FastResearch、登录或头像姓名与退出、CAS 认证和主题图标；移动端侧栏由菜单展开。工具选择使用 `?tool=fast-read` 等参数，辅助页面使用 `?view=today|insight|team`，支持刷新与浏览器返回。工作台使用普通滚动。
- 产品目录、应用菜单与工作台“了解应用”入口形成互相可达的页面体系。产品 CTA 进入对应工具或工作台，外部工具是否可用由部署配置决定。
- 文字区域下方使用带柔和渐隐的模糊遮挡，降低线路干扰；不使用文字发光，尤其主按钮保持清晰。图片使用真实脱敏界面或案例；没有截图的应用使用连续路线与步骤图示，不冒充运行数据。

## 可访问性

单个 H1、连续标题、可见键盘焦点、原生链接、产品菜单 Escape 关闭并恢复焦点。滚动区域可聚焦，支持方向键、空格、PageUp / PageDown、Home / End；未展示的章节设为 inert。系统减少动效偏好将切屏与路线推进设为即时完成；Ctrl + 滚轮继续用于浏览器缩放。图片失败时显示文字提示，入口仍可操作。

## Workspace 应用认证

`GET /api/workspace/apps` 返回应用入口状态；`GET /api/workspace/apps/{id}/launch` 仅跳转到服务端登记的目标，不接受用户传入跳转地址，不生成或转发 Research 票据。FastNews、FastRead、FastWrite 使用各自 `/api/auth/fastcas/login`，FastTask 使用 `/api/v1/auth/fastcas/login`，由子应用与 CAS 完成认证并签发自己的会话。已有 CAS 会话时可复用认证；子应用仍须配置 CAS，并按自身规则关联账号。

浏览器地址优先读取 `*_PUBLIC_URL`，随后使用对应 `VITE_*` 地址和服务地址；具体配置见 `.env.example`。FastPPT 本地工作台和 FastLab 设备关联保留直接入口。未来部署支持浏览器 CAS 登录时，可配置精确 `*_CAS_LOGIN_URL`；非法配置禁用进入按钮。未配置应用入口时显示说明。

顶栏退出会调用 `/api/content/logout` 撤销当前 FastResearch 会话。CAS 账号认证继续要求原 Key 证明，保留独立的登录开关、关联开关和解绑流程。

## 验证

`npm run build`、`npm run lint`、`npm test`。

`npm run test:fastui -- /path/to/chromium /path/to/evidence` 覆盖工作台深浅色、三视口、个人 Key、管理员长列表、原生 dialog 焦点与分发名册实际保存。

`EDGE_PATH=/path/to/chromium PROMO_CHECK_URL=http://127.0.0.1:8787/ npm run test:promo` 覆盖总产品页五视口、十个应用各桌面和移动端、一屏切换与章节推进、菜单、直达路由、中文固定、旧地址兼容、减少动效、图片回退与工作台无 footer。

`EDGE_PATH=/path/to/chromium PROMO_CHECK_URL=http://127.0.0.1:8787/ npm run test:journey` 单独验证真实动效、大幅滚动、持续惯性尾段、反向、首尾边界、键盘与触控，确认一次手势只移动一屏。
