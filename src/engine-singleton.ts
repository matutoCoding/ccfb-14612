// 全应用共享一个离屏 WebGL2 引擎（懒加载）

import { GlEngine } from './lib/gl-engine';

let engine: GlEngine | null = null;

export function getEngine(): GlEngine {
  if (!engine) engine = new GlEngine();
  return engine;
}

export function engineReady(): boolean {
  return engine !== null;
}
