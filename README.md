# 🦗 电子斗蛐蛐

让不同的 AI 模型同台竞技的对战平台：选游戏、配蛐蛐（2~4 名 AI 玩家 + 0~1 名 AI 裁判）、逐步推进观战。

## 启动

```bash
npm install
npm run dev        # 同时启动 API 代理(3001) 与前端(5173)
```

打开 http://localhost:5173

生产部署：`npm run build && npm start`（Express 同时托管打包产物与 API 代理）。

## 玩法

1. **选择游戏**：内置「石头剪子布·博弈版」（出拳前公开喊话博弈）与「吹牛（扑克）」；也可点「新增自定义游戏」按标准格式录入规则，由裁判 AI 主持运行。
2. **配置选手**：设置玩家数量，每名玩家/裁判填入 OpenAI 兼容的 `Base URL + API Key + 模型名`（DeepSeek、Kimi、Qwen、GLM、OpenAI 等均可），也可选「测试机器人」无需 key 快速体验。
3. **开始比赛**：每个 AI 决策/发言前都会停在底部确认条，由你点击「推进」控制节奏（也可打开自动连续推进）。比拼过程配有牌桌、手势动效与完整过程实录。

## 说明

- API Key 仅存浏览器 localStorage，经本机 `server/index.mjs` 代理转发，不上传任何第三方服务器。
- AI 输出非法 JSON / 非法动作时会自动带错误原因重试 3 次，仍失败则由系统代为随机合法行动，保证比赛不中断。
- 新游戏扩展：实现 `src/games/types.ts` 中的 `GameDefinition` 接口并在 `src/games/registry.ts` 注册即可获得完整引擎与 UI 支持。
