import type { PlatformAdapter } from './types';

// 抖音：snssdk1128 搜索深链 + 结果页小游戏入口卡片。
// 关键词必须带"小游戏入口"，只搜游戏名会被攻略帖压过卡片。
export const douyinAdapter: PlatformAdapter = {
  key: 'douyin',
  label: '抖音小游戏',
  defaultHostPackage: 'com.ss.android.ugc.aweme',
  searchKeyword: (gameName) => `${gameName}小游戏入口`,
  searchDeepLink: (keyword) =>
    `snssdk1128://search?keyword=${encodeURIComponent(keyword)}`,
};
