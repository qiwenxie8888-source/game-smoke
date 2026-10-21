import { douyinAdapter } from './douyin';
import type { PlatformAdapter, PlatformKey } from './types';

export * from './types';
export { douyinAdapter };

/** 已实现进入适配器的渠道；微信 / 官包 / B站 / 快手接入时在此登记 */
export const platformAdapters: Partial<Record<PlatformKey, PlatformAdapter>> = {
  douyin: douyinAdapter,
};
