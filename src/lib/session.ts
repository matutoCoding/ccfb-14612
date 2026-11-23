// 跨页面会话状态：当前选中的网模/浆料/最近一次仿真结果（内存态，记录另外落 IndexedDB）

import type { FurnishDoc, MoldDoc, SimSessionData } from './types';

interface SessionState {
  currentMold: MoldDoc | null;
  currentFurnish: FurnishDoc | null;
  lastSimulation: SimSessionData | null;
  /** 透光观察页设置 */
  lightMode: 'trans' | 'reflect';
  lightAngleDeg: number;
  sheetFlipped: boolean;
}

const state: SessionState = {
  currentMold: null,
  currentFurnish: null,
  lastSimulation: null,
  lightMode: 'trans',
  lightAngleDeg: 0,
  sheetFlipped: false,
};

const listeners = new Set<() => void>();

export function getState(): SessionState {
  return state;
}

export function setMold(m: MoldDoc | null): void {
  state.currentMold = m;
  emit();
}

export function setFurnish(f: FurnishDoc | null): void {
  state.currentFurnish = f;
  emit();
}

export function setSimulation(s: SimSessionData | null): void {
  state.lastSimulation = s;
  emit();
}

export function setLightSettings(patch: Partial<Pick<SessionState, 'lightMode' | 'lightAngleDeg' | 'sheetFlipped'>>): void {
  Object.assign(state, patch);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}
