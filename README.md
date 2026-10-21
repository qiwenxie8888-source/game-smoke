## 目录结构

```
platforms/                 # 渠道适配器：抖音 / 微信 / 官包 / B站 / 快手……
  types.ts                 # 适配器契约（搜索关键词、深链）
  douyin.ts
games/<渠道>/<游戏>/
  game.config.ts           # 进入链参数 + AI 上下文（唯一维护点）
  smoke/*.yaml             # 冒烟回归
  explore/*.yaml           # 结构化探索
scripts/
  games.ts                 # 游戏注册表（新增游戏在此登记）
  game-enter-node.ts       # game.enter 自定义 Node
```

新增一款游戏：复制 `games/douyin/edge-space` → 改 `game.config.ts` → 在 `scripts/games.ts` 登记。
用例里统一写 `- game.enter: { gameKey: douyin/<游戏目录> }`，不需要再重复进入链。

# game-smoke

A Midscene Test project for android.

If you skipped installation during creation, run `pnpm install --ignore-workspace`. The `postinstall` script automatically generates `midscene-node-spec.android.md` after each dependency installation. If lifecycle scripts are disabled, run `pnpm run nodes` manually.

Copy `.env.example` to `.env`, then choose and configure a model using the [supported models and setup guide](https://midscenejs.com/model-common-config.html). Do not commit `.env` to your repository; inject the model configuration as environment variables in CI.

After configuring `.env`, run `pnpm exec midscene-test model verify` from the project directory to check model connectivity and Midscene compatibility. This check does not require a browser or device. If it fails, see [Model debugging and observability](https://midscenejs.com/model-debugging-observability.html) before running tests.

Connect an Android device and verify it with `adb devices`. Set ANDROID_DEVICE_ID to select a device.

Run tests with `pnpm test`. Read `midscene-node-spec.android.md` for the available Nodes and their inputs.

After changing Node registrations in `midscene.config.ts`, run `pnpm run nodes` to refresh the spec. This loads the configuration without connecting to a device or running tests. Extension factories must only acquire runtime resources inside Node execution.

Reports are written to `midscene_run/report/`.
