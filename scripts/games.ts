// 游戏注册表：新增游戏时在此登记（key 必须与 game.config.ts 一致）。
import edgeSpace from '../games/douyin/edge-space/game.config';
import type { GameConfig } from '../games/types';

export const games: Readonly<Record<string, GameConfig>> = Object.freeze({
  [edgeSpace.key]: edgeSpace,
});

export const gameKeys: readonly string[] = Object.keys(games);

export function requireGame(gameKey: string): GameConfig {
  const game = games[gameKey];
  if (!game) {
    throw new Error(
      `未注册的游戏 "${gameKey}"；可用：${gameKeys.join(', ') || '（空）'}`
    );
  }
  return game;
}
