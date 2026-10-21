// 游戏注册配置：一个游戏一个 game.config.ts，进入链参数只在这里维护。
import type { PlatformKey } from '../platforms/types';

/** 用例集类型：冒烟回归 / 结构化探索 */
export type Suite = 'smoke' | 'explore';

export interface GameEnterConfig {
  /** 搜索关键词主体；缺省为 `${name}小游戏入口` */
  keyword?: string;
  /** 搜索结果页里游戏卡片的视觉描述（aiTap 定位用） */
  cardPrompt: string;
  /** 主菜单存在性判定（aiWaitFor / aiAssert 用） */
  menuPrompt: string;
  /** 冷启动后等待开屏页走完的毫秒数 */
  warmupMs?: number;
  /** 深链跳转后等待搜索结果渲染的毫秒数 */
  pageWaitMs?: number;
  /** 等待主菜单出现的毫秒数 */
  waitTimeoutMs?: number;
}

export interface GameConfig {
  /** 全局唯一键，形如 douyin/edge-space；YAML 通过它调用 game.enter */
  key: string;
  /** 展示名，同时是默认搜索关键词前缀 */
  name: string;
  channel: PlatformKey;
  /** 宿主包名；缺省取渠道适配器的默认值 */
  hostPackage?: string;
  enter: GameEnterConfig;
  /** 注入给 AI 的共通上下文 */
  aiContext?: string;
  /** 各用例集额外的 AI 上下文（如探索集的安全红线） */
  suiteContext?: Partial<Record<Suite, string>>;
}

export const defineGame = (config: GameConfig): GameConfig => config;
