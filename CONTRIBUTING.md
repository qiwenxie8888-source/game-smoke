# 协作规范

## 分支

从 `main` 切出，命名用「类型/简短描述」：

| 前缀 | 用途 | 示例 |
|---|---|---|
| `feat/` | 新功能、新增游戏或渠道 | `feat/wechat-adapter` |
| `fix/` | 修 bug | `fix/enter-retry` |
| `chore/` | 工程配置、依赖、CI | `chore/ci-setup` |
| `docs/` | 文档 | `docs/exploration-playbook` |

`main` 不接受直接推送，改动一律走 PR。

## 提交信息

格式：`类型: 说明`，与分支前缀一致，中文描述即可。

```
feat: 增加微信渠道进入适配器
fix: 修复 aiWaitFor 超时被步骤级 120s 提前掐断
chore: 补充 CI 工作流
```

一次提交只做一件事，不要把"改配置 + 修 bug + 调格式"混在一起。

## 提交前自检

```bash
pnpm typecheck    # TypeScript 类型
pnpm validate     # 用例 YAML 与节点名（不连设备、不调模型）
```

改前端时本地起服务看一眼：

```bash
.venv/Scripts/python -m uvicorn server.api:app --reload --port 8000
```

## 新增游戏 / 渠道

1. 复制 `games/<渠道>/<现有游戏>` 为新目录
2. 改 `game.config.ts`：`key`、`name`、`enter.cardPrompt`、`enter.menuPrompt`
3. 在 `scripts/games.ts` 登记
4. 用例里统一写 `- game.enter: { gameKey: <key> }`
5. 新增渠道时实现 `platforms/<渠道>.ts` 并在 `platforms/index.ts` 登记

## 不要提交的内容

`.env`（含密钥）、`midscene_run/`、`.midscene/`、`server/data/`、`.venv/`、`midscene-node-spec.*.md`，
均已在 `.gitignore` 中。截图和报告走 PR 描述里的链接，不放进仓库。
