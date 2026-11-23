// 抄造仿真编排：沉积生成 -> GPU splat -> readback 翻转 -> 匀度/纸病/收缩/清晰度 -> 记录

import type { FurnishDoc, MoldDoc, SimRecord, SimSessionData, SimStats, SimParams } from './types';
import { nowTs, uid } from './types';
import { SHEET_AREA_M2, generateFibers } from './deposition';
import { GlEngine, type ViewMode } from './gl-engine';
import { detectDefects, dryingShrinkage, formationAnalysis, watermarkClarity } from './analysis';
import { fingerprintFloat32 } from './rng';

export interface SimulationRunOptions {
  mold: MoldDoc;
  furnish: FurnishDoc;
  params: SimParams;
  engine: GlEngine;
  onProgress?: (msg: string, ratio: number) => void;
}

/** readPixels 原点在左下，分析/显示统一左上 -> 垂直翻转 */
export function flipVertical(a: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    const srcRow = h - 1 - y;
    out.set(a.subarray(srcRow * w, (srcRow + 1) * w), y * w);
  }
  return out;
}

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 半径 r 的盒滤波（边界复制），r=1 为 3x3，r=2 为 5x5 */
function boxSmooth(a: Float32Array, w: number, h: number, r = 1): Float32Array {
  const out = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      let s = 0;
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx++) s += a[row + xx];
      }
      out[y * w + x] = s / ((y1 - y0 + 1) * (x1 - x0 + 1));
    }
  }
  return out;
}

/**
 * 2x2 降采样到分析网格。仿真网格保留纤维级细节用于渲染，
 * 分析网格（约 0.5mm/px）对应真实纸张定量测试仪的采样尺度，
 * 每纹素覆盖约 4 根纤维，消除亚纤维尺度的泊松散粒噪声。
 */
function downsample2x(a: Float32Array, w: number, h: number): { data: Float32Array; w: number; h: number } {
  const hw = w >> 1;
  const hh = h >> 1;
  const out = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const i = (y * 2) * w + x * 2;
      out[y * hw + x] = (a[i] + a[i + 1] + a[i + w] + a[i + w + 1]) * 0.25;
    }
  }
  return { data: out, w: hw, h: hh };
}

export async function runSimulation(opts: SimulationRunOptions): Promise<SimSessionData> {
  const { mold, furnish, params, engine, onProgress } = opts;
  const t0 = performance.now();
  onProgress?.('生成纤维与絮聚场（确定性 PRNG）…', 0.15);
  await nextFrame();
  const dep = generateFibers({ mold, furnish, params });

  onProgress?.('GPU 沉积 splat（instanced + 加法混合）…', 0.55);
  await nextFrame();
  const glResult = engine.runDeposition(dep.reliefGrid, dep.flocField, dep.fibers, params.gridW, params.gridH, furnish.targetBasisWeight, SHEET_AREA_M2, dep.weightSum);

  onProgress?.('回读定量场并做纸面分析…', 0.8);
  await nextFrame();
  const basisFlipped = flipVertical(glResult.basis, params.gridW, params.gridH);
  // 单次 splat 无法表达真实纸页几十层纤维叠加：5x5 盒滤波等效纤维网络空间平均，再 2x2 降采样
  const basisSmoothed = boxSmooth(basisFlipped, params.gridW, params.gridH, 2);
  const ds = downsample2x(basisSmoothed, params.gridW, params.gridH);
  // 二次归一：浮点精度内分析网格均值严格等于目标定量，保证换种子零均值偏差
  let rawSum = 0;
  for (const v of ds.data) rawSum += v;
  const normFactor = furnish.targetBasisWeight / (rawSum / ds.data.length);
  const basis = new Float32Array(ds.data.length);
  for (let i = 0; i < basis.length; i++) basis[i] = ds.data[i] * normFactor;
  const thickDs = downsample2x(boxSmooth(flipVertical(glResult.thickness, params.gridW, params.gridH), params.gridW, params.gridH, 2), params.gridW, params.gridH);
  const thicknessGrid = thickDs.data.map((v) => v * normFactor);
  const analysisW = ds.w;
  const analysisH = ds.h;

  const formation = formationAnalysis(basis, analysisW, analysisH);
  const shrink = dryingShrinkage(mold, furnish);
  const defectResult = detectDefects(basis, analysisW, analysisH, mold, shrink.shrinkMdPct, shrink.shrinkCdPct);
  const clarity = watermarkClarity(basis, analysisW, analysisH, mold);

  let sum = 0;
  let sumSq = 0;
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of basis) {
    sum += v;
    sumSq += v * v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const mean = sum / basis.length;
  const std = Math.sqrt(Math.max(0, sumSq / basis.length - mean * mean));
  const counts = { pinhole: 0, thin: 0, floc: 0, distortion: 0 };
  for (const d of defectResult.defects) counts[d.kind]++;

  const elapsedMs = performance.now() - t0;
  const stats: SimStats = {
    meanBasisWeight: mean,
    stdBasisWeight: std,
    cvPercent: (std / mean) * 100,
    minBw: mn,
    maxBw: mx,
    rawMeanBw: mean,
    formationIndex: formation.formationIndex,
    clarity,
    defectCounts: counts,
    shrinkMdPct: shrink.shrinkMdPct,
    shrinkCdPct: shrink.shrinkCdPct,
    wmWidthBefore: shrink.wmWidthBefore,
    wmWidthAfter: shrink.wmWidthAfter,
    wmHeightBefore: shrink.wmHeightBefore,
    wmHeightAfter: shrink.wmHeightAfter,
    wmTolerancePct: shrink.wmTolerancePct,
    wmOutOfTolerance: shrink.outOfTolerance,
    elapsedMs,
  };

  onProgress?.('导出缩略图与指纹…', 0.95);
  await nextFrame();
  const thumbBasis = engine.toDataUrl(0 as ViewMode, glResult.reliefTex, glResult.flocTex, 0, false, 0.45);
  const thumbTrans = engine.toDataUrl(1 as ViewMode, glResult.reliefTex, glResult.flocTex, 0, false, 0.45);
  const thumbReflect = engine.toDataUrl(2 as ViewMode, glResult.reliefTex, glResult.flocTex, 0, false, 0.45);

  const fingerprint = fingerprintFloat32(
    basis,
    `${mold.id}:${mold.version}:${furnish.id}:${params.seed}:${params.fiberCount}:${params.gridW}x${params.gridH}:a${analysisW}x${analysisH}`,
  );

  const record: SimRecord = {
    id: uid('sim'),
    name: `${mold.name} / ${furnish.name} / #${params.seed}`,
    moldId: mold.id,
    moldVersion: mold.version,
    moldName: mold.name,
    furnishId: furnish.id,
    furnishName: furnish.name,
    params: { ...params },
    stats,
    createdAt: nowTs(),
    thumbBasis,
    thumbTrans,
    thumbReflect,
    fingerprint,
  };

  return {
    record,
    mold,
    furnish,
    basisGrid: basis,
    gridW: analysisW,
    gridH: analysisH,
    thicknessGrid,
    scaleCurve: { scalesMm: formation.scalesMm, cvCurve: formation.cvCurve },
    defects: defectResult.defects,
    fibers: dep.fibers,
    glTextures: { reliefTex: glResult.reliefTex, flocTex: glResult.flocTex, emboss: 0.45 },
  };
}
