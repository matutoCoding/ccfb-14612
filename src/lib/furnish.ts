// 浆料配方：三种浆配比、纤维长度/粗度/打浆度，长度分布由参数程序生成

import type { FurnishDoc } from './types';
import { nowTs, uid } from './types';
import { Rng } from './rng';

export function defaultFurnish(name = '标准防伪纸浆料 A'): FurnishDoc {
  return {
    id: uid('fur'),
    name,
    softwood: 0.45,
    hardwood: 0.35,
    cotton: 0.2,
    swLengthMm: 2.4,
    swCoarsenessMg: 16,
    hwLengthMm: 0.9,
    hwCoarsenessMg: 9,
    cotLengthMm: 1.8,
    cotCoarsenessMg: 12,
    beatingDegree: 42,
    headboxConsistency: 0.35,
    flowSpeed: 280,
    targetBasisWeight: 90,
    updatedAt: nowTs(),
    note: '',
  };
}

export interface FiberSpeciesSpec {
  key: 'softwood' | 'hardwood' | 'cotton';
  label: string;
  ratio: number;
  medianLength: number;
  coarseness: number; // mg/100m
  sigmaGeo: number; // 对数正态几何标准差
}

export function speciesSpecs(f: FurnishDoc): FiberSpeciesSpec[] {
  return [
    { key: 'softwood', label: '针叶木浆', ratio: f.softwood, medianLength: f.swLengthMm, coarseness: f.swCoarsenessMg, sigmaGeo: 1.55 },
    { key: 'hardwood', label: '阔叶木浆', ratio: f.hardwood, medianLength: f.hwLengthMm, coarseness: f.hwCoarsenessMg, sigmaGeo: 1.45 },
    { key: 'cotton', label: '棉浆', ratio: f.cotton, medianLength: f.cotLengthMm, coarseness: f.cotCoarsenessMg, sigmaGeo: 1.6 },
  ];
}

/** 归一化配比，保证三者之和为 1 */
export function normalizeRatios(f: FurnishDoc): FurnishDoc {
  const total = f.softwood + f.hardwood + f.cotton || 1;
  return { ...f, softwood: f.softwood / total, hardwood: f.hardwood / total, cotton: f.cotton / total };
}

/** 程序生成纤维长度分布直方图（对数正态混合），确定性由 seed 决定 */
export function generateLengthHistogram(f: FurnishDoc, seed = 1, bins = 32, samples = 20000): { lo: number; hi: number; count: number }[] {
  const rng = new Rng(seed);
  const specs = speciesSpecs(f);
  const weights = specs.map((s) => s.ratio);
  const maxLen = Math.max(...specs.map((s) => s.medianLength)) * 2.6;
  const binWidth = maxLen / bins;
  const counts = new Array(bins).fill(0);
  for (let n = 0; n < samples; n++) {
    const sp = specs[rng.pickIndex(weights)];
    let len = rng.lognormal(sp.medianLength, sp.sigmaGeo);
    // 打浆度越高，纤维被切断越多，长度整体收缩
    const beatFactor = 1 - Math.min(0.35, (f.beatingDegree - 20) / 200);
    len *= beatFactor;
    const idx = Math.min(bins - 1, Math.floor(len / binWidth));
    counts[idx]++;
  }
  return counts.map((count, i) => ({ lo: i * binWidth, hi: (i + 1) * binWidth, count }));
}

/** 单根纤维采样：返回浆种索引与长度 mm */
export function sampleFiber(f: FurnishDoc, rng: Rng): { species: number; lengthMm: number; coarseness: number } {
  const specs = speciesSpecs(f);
  const idx = rng.pickIndex(specs.map((s) => s.ratio));
  const sp = specs[idx];
  const beatFactor = 1 - Math.min(0.35, (f.beatingDegree - 20) / 200);
  const lengthMm = rng.lognormal(sp.medianLength * beatFactor, sp.sigmaGeo);
  return { species: idx, lengthMm: Math.max(0.15, lengthMm), coarseness: sp.coarseness };
}

export function ratioValid(f: FurnishDoc): boolean {
  const s = f.softwood + f.hardwood + f.cotton;
  return Math.abs(s - 1) < 1e-6 && f.softwood >= 0 && f.hardwood >= 0 && f.cotton >= 0;
}
