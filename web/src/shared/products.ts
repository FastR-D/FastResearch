import { BookOpenText,ChartNoAxesCombined,FlaskConical,Inbox,Layers,ListTodo,Microscope,Newspaper,PenLine,Presentation,ShieldCheck,type LucideIcon } from 'lucide-react'

export type Product = {
  id: string
  name: string
  category: string
  Icon: LucideIcon
  title: [string, string]
  description: string
  promise: string
  image?: string
  imageAlt?: string
  points: [string, string, string]
  steps: [string, string, string, string]
  features: { title: string; body: string }[]
  note: string
  tool?: string
  href?: string
}

export const products: Product[] = [
  {
    id: 'news', name: 'FastNews', category: '发现研究线索', Icon: Newspaper,
    title: ['看见领域新进展，', '找到自己的下一问。'],
    description: '把学术动态、顶会论文与领域导读放到一处。从一个关键词出发，发现值得继续追踪的研究线索。',
    promise: '让注意力，落在值得研究的问题上。',
    image: 'promo/module-news-static.webp', imageAlt: 'FastNews 研究总览、学术简报与论文动态界面',
    points: ['学术动态', '顶会论文', '领域导读'], steps: ['关注领域', '发现论文', '梳理方向', '继续研读'], tool: 'fast-news',
    features: [
      { title: '跟上研究现场', body: '从论文与安全资讯中浏览新进展，减少分散查找。' },
      { title: '从顶会切入', body: '按会议、年份和类别检索论文，围绕问题查找相关工作。' },
      { title: '形成领域视野', body: '结合领域导读与总结汇报，逐步建立研究方向的全景。' },
    ], note: '公开报告与个人内容的访问规则，以当前部署配置为准。',
  },
  {
    id: 'read', name: 'FastRead', category: '文献研读', Icon: BookOpenText,
    title: ['不止读过，', '理解，更可回溯。'],
    description: '从论文原文出发，提炼问题、方法与贡献。把报告、追问和个人总结留在同一篇论文旁，让理解能够回到页码核对。',
    promise: '每一个理解，都找得到原文。',
    image: 'promo/module-read-static.webp', imageAlt: 'FastRead 文献库、原文阅读和证据化报告界面',
    points: ['分页原文', '证据化报告', '持续追问'], steps: ['导入论文', '阅读原文', '核对证据', '沉淀理解'], tool: 'fast-read',
    features: [
      { title: '从原文开始', body: '导入 PDF 或论文链接，逐页阅读并组织自己的文献。' },
      { title: '围绕问题深读', body: '结合阅读报告、来源引用与持续追问，逐步理解关键方法。' },
      { title: '留下自己的判断', body: '整理个人总结与阅读笔记，为复盘和后续引用保留上下文。' },
    ], note: 'AI 生成的报告与回答需要结合论文原文核对。',
  },
  {
    id: 'write', name: 'FastWrite', category: '论文写作', Icon: PenLine,
    title: ['让积累进入草稿，', '让思考成为表达。'],
    description: '在同一工作区组织论文结构、编辑 LaTeX、查看编译预览。结合模板与 AI 辅助修改，把研究叙事一步步打磨完整。',
    promise: '从一个问题，写到一篇自己的论文。',
    image: 'promo/module-write-static.webp', imageAlt: 'FastWrite 大纲、LaTeX 编辑、AI 辅助和论文预览界面',
    points: ['论文模板', '在线编辑', 'AI 辅助修改'], steps: ['组织结构', '撰写草稿', '修改核对', '编译预览'], tool: 'fast-write',
    features: [
      { title: '结构与正文一起推进', body: '围绕论文大纲编辑内容，在项目中组织研究表达。' },
      { title: '把反馈变成修改', body: '使用 AI 辅助撰写、润色与审稿建议，持续改进草稿。' },
      { title: '看见论文的样子', body: '结合会议与期刊模板，查看 LaTeX 编译后的论文预览。' },
    ], note: '编译能力依赖服务端环境；事实、引用与最终提交内容由研究者核对。',
  },
  {
    id: 'ppt', name: 'FastPPT', category: '学术汇报', Icon: Presentation,
    title: ['把研究说清楚，', '把每一页改到位。'],
    description: '连接本地 Codex 或 Claude，在一个工作台中管理演示项目。指定元素、区域或页面的修改范围，查看前后差异与页面历史。',
    promise: '从研究内容，到更有说服力的汇报。',
    image: 'fastppt/assets/government/slide-06.webp', imageAlt: 'FastPPT 演示案例原稿页面',
    points: ['指定范围修改', '前后差异', '页面历史'], steps: ['创建项目', '明确范围', '检查修改', '回顾版本'], tool: 'fast-ppt',
    features: [
      { title: '用 Agent 推进演示', body: '接入本地 Codex 或 Claude，围绕演示项目开展制作与修改。' },
      { title: '让修改有所边界', body: '按元素、区域、页面或整套演示指定修改范围。' },
      { title: '每次变化看得见', body: '通过差异对照与历史回看，检查修改结果并保留演进过程。' },
    ], note: 'FastPPT 使用本地工作台；Agent 与工具入口需要单独配置。',
  },
  {
    id: 'lab', name: 'FastLab', category: '实验与验证', Icon: Microscope,
    title: ['让想法接受验证，', '让结果留下过程。'],
    description: '集中组织实验运行、结果分析与复现记录。围绕研究问题推进验证，让下一次比较与复盘有据可依。',
    promise: '从提出假设，到理解实验结果。',
    points: ['实验运行', '结果分析', '复现记录'], steps: ['提出假设', '运行实验', '比较结果', '整理记录'], tool: 'fast-lab',
    features: [
      { title: '围绕问题组织实验', body: '将需要验证的研究问题与实验过程集中管理。' },
      { title: '看清结果与差异', body: '整理实验结果，为分析与比较保留清楚的工作入口。' },
      { title: '保留复现线索', body: '将过程和记录留在研究链路中，方便后续回顾。' },
    ], note: '实验能力与访问权限，以实际部署和已接入环境为准。',
  },
  {
    id: 'task', name: 'FastTask', category: '目标与每日推进', Icon: ListTodo,
    title: ['把长期目标，', '变成今天的一步。'],
    description: '把科研目标拆成具体行动，通过对话安排与调整每日任务。用实际成果和专注记录，保留一步步向前的过程。',
    promise: '每天推进一点，让目标逐渐清晰。',
    points: ['目标任务树', '每日计划', '成果与专注'], steps: ['明确目标', '拆分行动', '安排今天', '记录成果'], href: '/api/fasttask/login',
    features: [
      { title: '从目标拆到行动', body: '用目标、里程碑和任务树表达长期计划与真实依赖。' },
      { title: '安排能完成的今天', body: '围绕主要目标形成每日计划，通过对话调整任务与排期。' },
      { title: '让推进留下证据', body: '分别记录小步骤、成果与专注过程，回顾实际做成的工作。' },
    ], note: '今日任务同步与统一登录需要配置 FastTask 服务。',
  },
  {
    id: 'insight', name: 'FastInsight', category: '论文情报分发', Icon: Inbox,
    title: ['让相关的新论文，', '主动来到你面前。'],
    description: '围绕研究方向、关键词与接收成员组织论文分发。在个人信箱中浏览论文摘要、打开原文并标记已读。',
    promise: '少一点信息噪声，多一点有方向的关注。',
    image: 'promo/insight.webp', imageAlt: 'FastInsight 论文信箱与论文详情界面',
    points: ['研究方向', '关键词分发', '个人信箱'], steps: ['设定方向', '匹配论文', '发送信箱', '阅读跟进'],
    features: [
      { title: '围绕方向分发', body: '通过方向与关键词整理相关线索，配置论文接收成员。' },
      { title: '在信箱里继续', body: '集中查看推荐内容、论文摘要与原文链接。' },
      { title: '用身份区分关注', body: '验证个人 Key 后进入专属信箱，记录已读状态。' },
    ], note: '需要配置论文来源与分发规则，并验证个人 Key。',
  },
  {
    id: 'figure', name: 'FastFigure', category: '科研绘图', Icon: ChartNoAxesCombined,
    title: ['把复杂的想法，', '画成清楚的图。'],
    description: '在科研绘图工作台中组织图元、连接与图表。结合可编辑的结构与受控助手修改，逐步完善论文中的视觉表达。',
    promise: '让方法、结构与数据，更容易被理解。',
    points: ['结构与图元', '图表编排', '受控编辑'], href: import.meta.env.VITE_FASTFIGURE_URL || 'https://figure.fastrd.io/', steps: ['组织结构', '连接图元', '编排图表', '完善表达'],
    features: [
      { title: '从结构搭起', body: '使用图元、箭头、组件与层级面板表达方法和系统结构。' },
      { title: '让图表保持一致', body: '整理多子图的对齐、图例与色标，逐步完善图面表达。' },
      { title: '可编辑地迭代', body: '结合原生结构与受控助手修改，持续调整图中的内容与样式。' },
    ], note: '当前服务的访问权限与功能范围，以实际部署为准。',
  },
  {
    id: 'cas', name: 'FastCAS', category: '统一身份', Icon: ShieldCheck,
    title: ['让每一次进入，', '都有清楚的身份。'],
    description: '为已接入的科研应用提供统一身份与账户关联。减少重复进入的负担，让团队按配置管理登录与访问。',
    promise: '在不同工具之间，延续同一个你。',
    points: ['统一登录', '账户关联', '访问管理'], steps: ['验证身份', '关联账户', '进入应用', '管理访问'],
    features: [
      { title: '统一的登录入口', body: '已接入应用可通过 FastCAS 完成身份验证。' },
      { title: '关联已有账户', body: '按应用支持的流程，将已有个人身份与统一账户建立关联。' },
      { title: '由配置决定访问', body: '尊重各应用的账户状态与权限，统一身份不替代业务授权。' },
    ], note: '仅对已配置并接入 FastCAS 的应用生效。',
  },
  {
    id: 'ui', name: 'FastUI', category: '统一交互基础', Icon: Layers,
    title: ['把一致的体验，', '带到每一个工具。'],
    description: 'FastUI 0.3.0 为系列应用提供语义色彩、基础控件与工作台组件。在产品自己的表达之下，延续一致的操作习惯。',
    promise: '不同的研究工具，共同的体验基础。',
    points: ['语义主题', '基础控件', '工作台组件'], steps: ['建立主题', '组合控件', '组织工作台', '适配设备'], href: 'https://fastr-d.github.io/FastUI/',
    features: [
      { title: '同一套语义基础', body: '通过主题 token 统一浅色、深色与交互状态。' },
      { title: '让交互有章可循', body: '用原生表单、对话框、工具栏与分段控件承接常见操作。' },
      { title: '为不同产品留空间', body: '提供基础能力，由应用组织自己的业务布局和品牌叙事。' },
    ], note: 'FastUI 是开发者组件与样式基础，可打开文档查看接入方式。',
  },
]

export const productHref = (id: string) => `${import.meta.env.BASE_URL}intro/${id}`
export const workspaceHref = `${import.meta.env.BASE_URL}workspace`
export function launchHref(product: Product) {
  if (product.href) return product.href.startsWith('/') ? `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}${product.href}` : product.href
  if (product.tool) return `${workspaceHref}?tool=${product.tool}`
  return `${workspaceHref}${product.id === 'insight' ? '?view=insight' : ''}`
}
export const ResearchIcon = FlaskConical
