# 任务计划：项目总结 & 冗余文档清理

## 目标
对「电子斗蛐蛐」项目做完整现状总结，识别并清理冗余/过期文件。

## 当前阶段
阶段 5

## 各阶段

### 阶段 1：发现与扫描
- [x] 列出所有非 node_modules 项目文件
- [x] 读取 .gitignore、README.md、原始需求文档
- [x] 读取 .claude/settings.local.json、launch.json
- [x] 比对各文件用途与内容
- **状态：** complete

### 阶段 2：总结 & 输出优化建议
- [x] 撰写项目现状总结（架构 + 功能 + 文件树）
- [x] 列出冗余 / 可清理项及理由
- [x] 提出具体操作建议（删除 / 归档 / gitignore 补充）
- **状态：** complete

### 阶段 3：执行清理
- [x] `.gitignore` 新增 `.claude/settings.local.json`（文件从未入库，无需 git rm）
- [x] `电子斗蛐蛐.md` 保留为历史存档（无需操作）
- **状态：** complete

## 已做决策
| 决策 | 理由 |
|------|------|
| 保留 `电子斗蛐蛐.md` 为只读历史文件 | 是创始需求原稿，有考古价值，不影响 git |
| `.claude/settings.local.json` 补 gitignore | 累积的本机测试命令许可白名单，属机器本地配置，不应入库 |
| `dist/` 已正确 gitignore | 无需操作 |

### 阶段 4：实现 0614-2 预模拟模式 — 设计
- [x] 确定 SimFrame 数据结构（存 gameStateAfter + eventsAfter 供 replay 直接应用）
- [x] 读取 SetupPage、TopProgress、ConfirmBar 源码
- [x] 制定五文件修改计划
- **状态：** complete

### 阶段 5：实现 0614-2 预模拟模式 — 编码
- [x] match.ts：SimFrame 接口 + runSimulation() + startMatch(simMode) + advance() replay 分支
- [x] SetupPage.tsx：添加模拟模式 toggle + 按钮文案切换
- [x] TopProgress.tsx：status==='simulating' 时展示步数，replay 时显示进度 X/Y
- [x] ConfirmBar.tsx：simulating 时隐藏，replay 时显示 ⚡ 快进
- [x] styles.css：.sim-mode-row / .sim-toggle / .sim-hint 样式
- [x] tsc --noEmit 零错误
- **状态：** complete

## 遇到的错误
| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
| PowerShell session-catchup 在 Bash 工具中无法运行 | 1 | 改用 PowerShell 工具 |
