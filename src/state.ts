// ===== 跨页面共享的内存状态（最近使用 / 最新仿真结果）=====
import type { MoldDesign, PulpRecipe, SimResult } from './types';
import type { GpuDepositEngine } from './sim/gpuEngine';

interface AppState {
  selectedMoldId?: string;
  selectedRecipeId?: string;
  lastSimResult?: SimResult;
  lastEngine?: GpuDepositEngine;
  lastFieldTex?: WebGLTexture;
  /** 透光页/纸病页复用的结果 id */
  lastSimId?: string;
  molds: MoldDesign[];
  recipes: PulpRecipe[];
  sims: SimResult[];
}

const state: AppState = {
  molds: [],
  recipes: [],
  sims: [],
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  for (const l of listeners) l();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
