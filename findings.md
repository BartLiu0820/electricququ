# 发现与决策 — 电子斗蛐蛐项目总结

## 项目定位
AI 模型对战平台：2~4 个 AI 模型同台竞技内置小游戏，支持 0~1 名 AI 裁判，逐步推进、可视化观战。

---

## 技术栈
| 层 | 技术 |
|---|---|
| 前端 | Vite + React 18 + TypeScript |
| 状态管理 | Zustand (`src/store/match.ts`) |
| 后端代理 | Node.js + Express (`server/index.mjs`) |
| AI 协议 | 统一 OpenAI 兼容 SSE 流式 |
| 样式 | 纯 CSS（无动画库） |
| 音效 | Web Audio API 合成（无音频文件） |

---

## 当前文件树（去除 node_modules / dist / .git）

```
电子斗蛐蛐/
├── .claude/
│   ├── launch.json            ← Claude 启动配置（本机）
│   └── settings.local.json   ← 本机命令权限白名单（应 gitignore）
├── server/
│   └── index.mjs             ← Express 代理，SSE 流转发，温度兜底重试
├── src/
│   ├── App.tsx / main.tsx
│   ├── types.ts              ← GameEvent、MatchConfig、AIResponse 等核心类型
│   ├── styles.css
│   ├── sound.ts              ← Web Audio 音效合成
│   ├── engine/
│   │   ├── aiClient.ts       ← callModelStream（SSE）、parseAIResponse
│   │   └── prompts.ts        ← buildMessages：系统提示 + 公开记录 + 决断块
│   ├── store/
│   │   └── match.ts          ← Zustand：对局状态机、预取、流式思考瞬态
│   ├── games/
│   │   ├── types.ts          ← GameDefinition<S> 接口、PendingAction
│   │   ├── registry.ts
│   │   ├── rps/              ← 石头剪子布：4步流程（喊话→出拳→亮拳→点评）
│   │   ├── bluff/            ← 吹牛：54张牌守恒、pile-on-table 架构
│   │   └── custom/           ← 裁判驱动通用游戏
│   └── components/
│       ├── SetupPage.tsx     ← 游戏选择、API 配置、快速粘贴识别
│       ├── MatchPage.tsx     ← 对局主页面，音效、TopProgress
│       ├── ConfirmBar.tsx    ← 推进按钮、流式思考触发
│       ├── ChatLog.tsx       ← 聊天气泡、实时流式思考泡、思考小结
│       ├── TopProgress.tsx   ← 当前环节 + 计时 + 进度条
│       └── GameEditor.tsx    ← 自定义游戏录入
├── .env                      ← API 密钥（gitignored）
├── .env.example              ← 密钥格式示例（入库）
├── .gitignore
├── package.json / tsconfig.json / vite.config.ts / index.html
├── README.md                 ← 用户文档（入库）
├── 电子斗蛐蛐.md             ← 原始需求文稿（入库，历史存档）
├── 开发日志.md               ← 开发历程（gitignored，本机留存）
└── 问题记录.md               ← Bug 追踪（gitignored，本机留存）
```

---

## 核心功能清单（已完成）
- [x] 游戏引擎：`GameDefinition<S>` 接口，扩展只需实现接口并注册
- [x] OpenAI 兼容 SSE 流式调用（`callModelStream`），服务端超时随流起解除
- [x] 流式思维链实时展示（`streamingThinking` Zustand 瞬态 + `▍` 光标动效）
- [x] 预取机制（`awaiting-confirm` 阶段后台预热，用户点推进秒出）
- [x] 3 次重试 + 兜底随机行动（保证比赛不中断）
- [x] 信息隐藏（每个 AI 只见自己手牌 + 公开记录）
- [x] 石头剪子布：喊话博弈 → 同时出拳 → 亮拳揭晓 → 裁判点评
- [x] 吹牛（扑克）：54 张守恒、pile-on-table 架构、质疑翻牌
- [x] 自定义游戏（裁判 AI 驱动）
- [x] 游戏音效（Web Audio 合成）
- [x] 顶部环节进度条 + 计时
- [x] 逐步推进 / 自动连续推进 / 静音开关
- [x] 快速 API 配置粘贴识别
- [x] 多语言推理强制中文指令（prompts.ts）

---

## 冗余 / 可优化项分析

### 🔴 高优先级（建议操作）

| 文件 | 问题 | 建议 |
|------|------|------|
| `.claude/settings.local.json` | 本机测试命令白名单，包含特定 API 测试命令；属机器本地配置，误入库会导致其他机器权限污染 | **补入 `.gitignore`**：`.claude/settings.local.json` |

### 🟡 中优先级（可考虑）

| 文件 | 问题 | 建议 |
|------|------|------|
| `电子斗蛐蛐.md` | 原始需求文稿，内容粗糙（含维基百科链接）；功能已由 README.md 完整覆盖 | 可选：保留作历史档案，或删除减少根目录噪音 |
| `dist/` 目录 | 已构建产物，gitignored，本地存在 | 可手动 `Remove-Item dist -Recurse -Force` 清理本地，或保留无妨 |

### 🟢 无需操作（已正确处理）

| 文件 | 状态 |
|------|------|
| `.env` | gitignored ✓ |
| `开发日志.md` | gitignored ✓ |
| `问题记录.md` | gitignored ✓ |
| `node_modules/` | gitignored ✓ |
| `.claude/launch.json` | 项目级启动配置，无敏感信息，入库合理 ✓ |
| `README.md` | 完整用户文档 ✓ |

---

## 技术决策记录
| 决策 | 理由 |
|------|------|
| 统一用 `callModelStream`（含静默流） | 避免慢模型被 60s 服务端超时误杀 |
| pile-on-table 架构（吹牛） | 消除 `pendingCollect`，保证 54 张牌恒不变 |
| Zustand `streamingThinking` 瞬态 | 避免将进行中的流式内容存入持久事件流 |
| 预取跳过 `streamThinking` 步 | 让用户从头看到思考过程，避免预取白白消耗思维链 |
| `shuffle()` 决定先手 | 公平掷硬币，每局随机顺序 |
