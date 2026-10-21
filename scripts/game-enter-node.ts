// 自定义 Node：game.enter
// 把"进入小游戏"的固定流程封装成 YAML 可调用的一步：
//   注入游戏上下文 → 冷启动宿主 → 深链搜索（游戏名+小游戏入口）
//   → AI 视觉定位点击游戏卡片 → 等待游戏主菜单
// 进入链参数统一来自 games/<渠道>/<游戏>/game.config.ts，YAML 只传 gameKey 与用例集。
// 内建一次"卡片没找到 → 返回重搜"的重试，缓解网络/页面加载抖动。
import { defineNode, z } from '@midscene/test';
import type { NodeExecutionContext } from '@midscene/test';
import { execSync } from 'node:child_process';
import { platformAdapters } from '../platforms';
import { requireGame } from './games';
import type { ProjectContext } from './context';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ADB = process.env.ANDROID_DEVICE_ID
  ? `adb -s ${process.env.ANDROID_DEVICE_ID}`
  : 'adb';

const gameEnterInputSchema = z.strictObject({
  gameKey: z
    .string()
    .describe('game.config.ts 中的游戏 key，如 douyin/edge-space'),
  profile: z
    .enum(['smoke', 'explore'])
    .default('smoke')
    .describe('用例集类型，决定叠加哪份 AI 上下文'),
  hostPackage: z.string().optional().describe('覆盖渠道默认的宿主包名'),
  warmupMs: z.number().optional().describe('覆盖冷启动后等待开屏页的毫秒数'),
  pageWaitMs: z.number().optional().describe('覆盖深链跳转后等待渲染的毫秒数'),
  waitTimeoutMs: z.number().optional().describe('覆盖等待主菜单的超时毫秒数'),
});

type GameEnterInput = z.infer<typeof gameEnterInputSchema>;

export const gameEnter = defineNode({
  name: 'game.enter',
  description:
    '按 gameKey 查游戏配置 → 注入 AI 上下文 → 冷启动宿主 → 深链搜索 → AI 点击游戏卡片 → 等待主菜单',
  inputSchema: gameEnterInputSchema,
  async execute({
    input,
    context,
  }: NodeExecutionContext<GameEnterInput, ProjectContext>) {
    const game = requireGame(input.gameKey);
    const adapter = platformAdapters[game.channel];
    if (!adapter) {
      throw new Error(
        `渠道 "${game.channel}" 尚未实现进入适配器，请在 platforms/index.ts 登记`
      );
    }

    const aiContext = [game.aiContext, game.suiteContext?.[input.profile]]
      .filter(Boolean)
      .join('\n');
    if (aiContext) {
      context.agent.setAIContext('default', aiContext);
    }

    const hostPackage =
      input.hostPackage ?? game.hostPackage ?? adapter.defaultHostPackage;
    if (!hostPackage) {
      throw new Error(`游戏 "${game.key}" 未配置宿主包名`);
    }

    const keyword = adapter.searchKeyword(game.enter.keyword ?? game.name);
    const deepLink = adapter.searchDeepLink(keyword);
    const warmupMs = input.warmupMs ?? game.enter.warmupMs ?? 10000;
    const pageWaitMs = input.pageWaitMs ?? game.enter.pageWaitMs ?? 6000;
    const waitTimeoutMs =
      input.waitTimeoutMs ?? game.enter.waitTimeoutMs ?? 150000;

    const openSearch = async () => {
      execSync(
        `${ADB} shell am start -a android.intent.action.VIEW -d "${deepLink}" ${hostPackage}`,
        { stdio: 'ignore' }
      );
      await sleep(pageWaitMs);
    };

    // 1) 冷启动宿主，保证起点状态确定
    execSync(`${ADB} shell am force-stop ${hostPackage}`, {
      stdio: 'ignore',
    });
    execSync(
      `${ADB} shell monkey -p ${hostPackage} -c android.intent.category.LAUNCHER 1`,
      { stdio: 'ignore' }
    );
    await sleep(warmupMs);

    // 2) 深链直达搜索结果页
    await openSearch();

    // 3) AI 视觉定位点击游戏卡片；找不到时返回并重搜一次
    try {
      await context.agent.aiTap(game.enter.cardPrompt);
    } catch {
      execSync(`${ADB} shell input keyevent 4`, { stdio: 'ignore' });
      await sleep(2000);
      await openSearch();
      await context.agent.aiTap(game.enter.cardPrompt);
    }

    // 4) 等待游戏主菜单出现（视觉关卡）
    await context.agent.aiWaitFor(game.enter.menuPrompt, {
      timeoutMs: waitTimeoutMs,
    });

    return {
      summary: `已进入《${game.name}》`,
      data: { gameKey: game.key, keyword, deepLink, hostPackage },
    };
  },
});
