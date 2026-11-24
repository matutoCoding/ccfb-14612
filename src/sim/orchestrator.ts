// ===== 仿真编排：GPU 沉积 + CPU 分析 -> SimResult =====
import type { MoldDesign, PulpRecipe, SimResult } from '../types';
import { GpuDepositEngine } from './gpuEngine';
import {
  detectDefects,
  dryingShrink,
  fieldStats,
  formationIndex,
  multiScaleCurve,
  watermarkClarity,
  watermarkDrift,
  type FieldData,
} from './analysis';
import { boxBlur } from './mold';
import { uid } from '../db';

/** 把网模浮雕重采样到仿真栅格（双线性近似：按比例最近邻+模糊） */
export function resampleRelief(
  relief: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const out = new Float32Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = (y / dstH) * srcH;
    const y0 = Math.min(srcH - 1, Math.floor(sy));
    const fy = sy - y0;
    const y1 = Math.min(srcH - 1, y0 + 1);
    for (let x = 0; x < dstW; x++) {
      const sx = (x / dstW) * srcW;
      const x0 = Math.min(srcW - 1, Math.floor(sx));
      const fx = sx - x0;
      const x1 = Math.min(srcW - 1, x0 + 1);
      const a = relief[y0 * srcW + x0] * (1 - fx) + relief[y0 * srcW + x1] * fx;
      const b = relief[y1 * srcW + x0] * (1 - fx) + relief[y1 * srcW + x1] * fx;
      out[y * dstW + x] = a * (1 - fy) + b * fy;
    }
  }
  return boxBlur(out, dstW, dstH, 1);
}

export interface RunContext {
  canvas: HTMLCanvasElement;
  mold: MoldDesign;
  recipe: PulpRecipe;
  seed: number;
  gridSize?: number;
  fiberCount?: number;
  orientationRandomness?: number;
  onProgress?: (pct: number, stage: string) => void;
}

export async function runSimulation(ctx: RunContext): Promise<{ result: SimResult; engine: GpuDepositEngine; fieldTex: WebGLTexture }> {
  const { canvas, mold, recipe } = ctx;
  if (!mold.relief || !mold.gridW || !mold.gridH) throw new Error('网模浮雕数据缺失');
  const seed = ctx.seed >>> 0;
  const params = {
    moldId: mold.id,
    recipeId: recipe.id,
    seed,
    widthMm: mold.widthMm,
    heightMm: mold.heightMm,
    gridSize: ctx.gridSize ?? 320,
    fiberCount: ctx.fiberCount ?? 360000,
    orientationRandomness: ctx.orientationRandomness ?? 0.55,
  };

  const engine = new GpuDepositEngine(canvas);
  const { gridW, gridH } = engine.computeGrid(params);
  const relief = resampleRelief(mold.relief, mold.gridW, mold.gridH, gridW, gridH);

  // 让一帧让 UI 进度条先刷新
  await new Promise((r) => requestAnimationFrame(() => r(null)));

  const t0 = performance.now();
  const out = engine.run(params, recipe, relief, ctx.onProgress);
  const elapsedMs = performance.now() - t0;

  const f: FieldData = {
    field: out.thickness,
    w: gridW,
    h: gridH,
    widthMm: mold.widthMm,
    heightMm: mold.heightMm,
  };
  const stats = fieldStats(f);
  const curve = multiScaleCurve(f);
  const fi = formationIndex(f, curve);
  const clarity = watermarkClarity(f, relief);
  const defects = detectDefects(f, relief);
  const shrink = dryingShrink(recipe);
  const drift = watermarkDrift(shrink, 1.5);

  const defectCounts = { pinhole: 0, thinSpot: 0, floc: 0, watermarkDistortion: 0 };
  for (const d of defects) defectCounts[d.kind]++;

  // 取向场（从场的角度通道拆出 2 分量）
  const orientation = new Float32Array(gridW * gridH * 2);
  for (let i = 0; i < gridW * gridH; i++) {
    const a = out.thickness[i * 4 + 1];
    orientation[i * 2] = Math.cos(a);
    orientation[i * 2 + 1] = Math.sin(a);
  }

  const result: SimResult = {
    id: uid('sim'),
    params,
    moldName: mold.name,
    recipeName: recipe.name,
    createdAt: Date.now(),
    elapsedMs,
    meanBasisWeight: stats.mean,
    stdBasisWeight: stats.std,
    cvBasisWeight: stats.cv,
    formationIndex: fi,
    scaleCurve: curve,
    clarity,
    defects,
    defectCounts,
    shrinkMD: shrink.mdPct,
    shrinkCD: shrink.cdPct,
    watermarkSizeDrift: drift,
    thicknessField: out.thickness,
    orientationField: orientation,
    gridW,
    gridH,
    widthMm: mold.widthMm,
    heightMm: mold.heightMm,
  };

  const fieldTex = engine.uploadField(out.thickness, gridW, gridH);
  return { result, engine, fieldTex };
}
