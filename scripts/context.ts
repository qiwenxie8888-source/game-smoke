import type { AndroidAgent } from '@midscene/android';

/** project setup 注入、供自定义 Node 使用的运行时上下文 */
export interface ProjectContext {
  agent: AndroidAgent;
}
