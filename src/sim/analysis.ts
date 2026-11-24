// ===== 纸面分析：匀度 / 多尺度波动 / 纸病 / 干燥收缩 / 水印清晰度 =====
import type { DefectRecord, PulpRecipe, SimResult } from '../types';
import { Rng } from './rng';
import { blendProperties } from './pulp';

export interface FieldData {
  field: Float32Array; // RGBA: r=定量 g=取向角 b=浮雕 a=絮聚
  w: number;
  h: number;
  widthMm: number;
  heightMm: number;
}

const idx = (w: number, x: number, y: number) => (y * w + x) * 4;

/** 统计均值/标准差/CV */
export function fieldStats(f: FieldData): { mean: number; std: number; cv: number; min: number; max: number } {
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  const n = f.w * f.h;
  for (let i = 0; i < n; i++) {
    const v = f.field[i * 4];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = f.field[i * 4] - mean;
    sq += d * d;
  }
  const std = Math.sqrt(sq / n);
  return { mean, std, cv: (std / mean) * 100, min, max };
}

/** 盒式模糊（用于多尺度分解） */
function boxAverage(src: Float32Array, w: number, h: number, radius: number, channel: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = 0; x < radius; x++) acc += src[idx(w, x, y) + channel];
    for (let x = 0; x < w; x++) {
      const add = Math.min(w - 1, x + radius);
      const sub = Math.max(0, x - radius - 1);
      acc += src[idx(w, add, y) + channel] - src[idx(w, sub, y) + channel];
      tmp[y * w + x] = acc / Math.min(w, 2 * radius + 1);
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = 0; y < radius; y++) acc += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const add = Math.min(h - 1, y + radius);
      const sub = Math.max(0, y - radius - 1);
      acc += tmp[add * w + x] - tmp[sub * w + x];
      out[y * w + x] = acc / Math.min(h, 2 * radius + 1);
    }
  }
  return out;
}

/**
 * 多尺度波动曲线：对不同尺度窗口做局部均值，计算局部均值的方差。
 * 参考 TAPPI 匀度思路（频谱/尺度分解），尺度 1~30mm。
 */
export function multiScaleCurve(f: FieldData): { scaleMm: number; variance: number }[] {
  const pxPerMm = f.w / f.widthMm;
  const scales = [1, 2, 3, 5, 8, 12, 18, 25, 30];
  const out: { scaleMm: number; variance: number }[] = [];
  for (const sMm of scales) {
    const r = Math.max(1, Math.round(sMm * pxPerMm * 0.5));
    const avg = boxAverage(f.field, f.w, f.h, r, 0);
    let sum = 0;
    for (let i = 0; i < avg.length; i++) sum += avg[i];
    const mean = sum / avg.length;
    let v = 0;
    for (let i = 0; i < avg.length; i++) {
      const d = avg[i] - mean;
      v += d * d;
    }
    out.push({ scaleMm: sMm, variance: v / avg.length });
  }
  return out;
}

/**
 * 匀度指数（0~100，越高越匀）：
 * 基于小尺度（≤3mm）定量 CV 映射，并结合多尺度方差加权。
 */
export function formationIndex(f: FieldData, curve: { scaleMm: number; variance: number }[]): number {
  const stats = fieldStats(f);
  const smallScales = curve.filter((c) => c.scaleMm <= 3);
  // 取小尺度方差均值再开根（RMS），量纲与标准差一致，避免多尺度方差重复累加
  const smallVar = smallScales.reduce((s, c) => s + c.variance, 0) / Math.max(1, smallScales.length);
  const smallCv = Math.sqrt(smallVar) / stats.mean;
  // 匀度评分（小尺度定量 CV 经验映射）：
  // CV 3% -> ~92（优），5% -> ~80，8% -> ~60，12% -> ~38，18% -> ~18
  const score = 100 * Math.exp(-Math.pow(smallCv / 0.135, 1.4));
  return Math.round(Math.min(99, Math.max(5, score)));
}

/**
 * 好纸基准样（用于曲线对比）：按目标均值动态生成。
 * 好纸小尺度定量 CV 约 4%，方差随尺度增大而平缓下降（大尺度更匀）。
 */
export function referenceCurve(mean = 90): { scaleMm: number; variance: number }[] {
  const scales = [1, 2, 3, 5, 8, 12, 18, 25, 30];
  const baseVar = (mean * 0.04) ** 2; // 4% CV 对应的方差
  return scales.map((sMm) => ({
    scaleMm: sMm,
    variance: baseVar * (1.35 - 0.35 * Math.log10(sMm + 1) / Math.log10(31)),
  }));
}

/** 连通域标记（4 邻域迭代栈，限制最大域数） */
function labelComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  limit = 400,
): { label: Int32Array; regions: { id: number; pixels: number; cx: number; cy: number; minV: number; maxV: number }[] } {
  const label = new Int32Array(w * h).fill(-1);
  const regions: NonNullable<ReturnType<typeof labelComponents>['regions']> = [];
  const stack: number[] = [];
  let nextId = 0;
  for (let y0 = 0; y0 < h; y0++) {
    for (let x0 = 0; x0 < w; x0++) {
      const start = y0 * w + x0;
      if (!mask[start] || label[start] >= 0) continue;
      if (nextId >= limit) return { label, regions };
      const id = nextId++;
      let pixels = 0;
      let sx = 0;
      let sy = 0;
      let minV = Infinity;
      let maxV = -Infinity;
      stack.length = 0;
      stack.push(start);
      label[start] = id;
      while (stack.length) {
        const p = stack.pop()!;
        const x = p % w;
        const y = (p / w) | 0;
        pixels++;
        sx += x;
        sy += y;
        if (x > 0 && mask[p - 1] && label[p - 1] < 0) {
          label[p - 1] = id;
          stack.push(p - 1);
        }
        if (x < w - 1 && mask[p + 1] && label[p + 1] < 0) {
          label[p + 1] = id;
          stack.push(p + 1);
        }
        if (y > 0 && mask[p - w] && label[p - w] < 0) {
          label[p - w] = id;
          stack.push(p - w);
        }
        if (y < h - 1 && mask[p + w] && label[p + w] < 0) {
          label[p + w] = id;
          stack.push(p + w);
        }
      }
      regions.push({ id, pixels, cx: sx / pixels, cy: sy / pixels, minV, maxV });
    }
  }
  return { label, regions };
}

/**
 * 纸病自动检测：
 *  - pinhole 针眼：极低定量 + 小面积（浮雕陡边诱发）
 *  - thinSpot 薄斑：低定量、面积较大
 *  - floc 絮团：高定量团块
 *  - watermarkDistortion 水印走形：浮雕区内实际厚度跟随误差超阈
 */
export function detectDefects(f: FieldData, relief: Float32Array): DefectRecord[] {
  const { mean, std } = fieldStats(f);
  const { w, h } = f;
  const pxPerMmX = w / f.widthMm;
  const pxPerMmY = h / f.heightMm;
  const cellMm2 = (f.widthMm / w) * (f.heightMm / h);
  const defects: DefectRecord[] = [];

  // —— 薄 / 洞 掩码 ——
  const thinMask = new Uint8Array(w * h);
  const holeMask = new Uint8Array(w * h);
  const flocMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = f.field[i * 4];
    if (v < mean - 2.2 * std) thinMask[i] = 1;
    if (v < mean - 3.2 * std) holeMask[i] = 1;
    if (v > mean + 2.4 * std) flocMask[i] = 1;
  }

  const thin = labelComponents(thinMask, w, h);
  const holes = labelComponents(holeMask, w, h);
  const flocs = labelComponents(flocMask, w, h);

  const holeIds = new Set(holes.regions.map((r) => r.id));
  for (const r of holes.regions) {
    const areaMm2 = r.pixels * cellMm2;
    if (areaMm2 < 0.05) continue;
    const radiusMm = Math.sqrt(areaMm2 / Math.PI);
    defects.push({
      kind: 'pinhole',
      cx: r.cx / w,
      cy: r.cy / h,
      radiusMm,
      areaMm2,
      grade: areaMm2 > 2 ? 3 : areaMm2 > 0.8 ? 2 : 1,
      measure: areaMm2,
    });
  }
  for (const r of thin.regions) {
    if (holeIds.has(r.id)) continue;
    const areaMm2 = r.pixels * cellMm2;
    if (areaMm2 < 1) continue;
    defects.push({
      kind: 'thinSpot',
      cx: r.cx / w,
      cy: r.cy / h,
      radiusMm: Math.sqrt(areaMm2 / Math.PI),
      areaMm2,
      grade: areaMm2 > 7 ? 3 : areaMm2 > 3.5 ? 2 : 1,
      measure: areaMm2,
    });
  }
  for (const r of flocs.regions) {
    const areaMm2 = r.pixels * cellMm2;
    if (areaMm2 < 2) continue;
    defects.push({
      kind: 'floc',
      cx: r.cx / w,
      cy: r.cy / h,
      radiusMm: Math.sqrt(areaMm2 / Math.PI),
      areaMm2,
      grade: areaMm2 > 6 ? 3 : areaMm2 > 3.2 ? 2 : 1,
      measure: areaMm2,
    });
  }

  // —— 水印走形：浮雕区（|relief|>15μm）内厚度调制与浮雕的局部相关失配 ——
  const wmMask = new Uint8Array(w * h);
  let wmCount = 0;
  for (let i = 0; i < w * h; i++) {
    if (Math.abs(relief[i]) > 15) {
      wmMask[i] = 1;
      wmCount++;
    }
  }
  if (wmCount > 50) {
    // 期望厚度：凸→薄、凹→厚，按局部平均归一
    const mismatch = new Uint8Array(w * h);
    let mismatchCount = 0;
    for (let i = 0; i < w * h; i++) {
      if (!wmMask[i]) continue;
      const v = f.field[i * 4];
      const expectSign = relief[i] > 0 ? -1 : 1; // 凸处偏薄
      const z = (v - mean) / std;
      if (expectSign * z < -1.1) {
        mismatch[i] = 1;
        mismatchCount++;
      }
    }
    if (mismatchCount / wmCount > 0.12) {
      const comps = labelComponents(mismatch, w, h, 60);
      for (const r of comps.regions) {
        const areaMm2 = r.pixels * cellMm2;
        if (areaMm2 < 2) continue;
        defects.push({
          kind: 'watermarkDistortion',
          cx: r.cx / w,
          cy: r.cy / h,
          radiusMm: Math.sqrt(areaMm2 / Math.PI),
          areaMm2,
          grade: areaMm2 > 10 ? 3 : areaMm2 > 5 ? 2 : 1,
          measure: areaMm2,
        });
      }
    }
  }

  // 数量控制：按面积降序保留前 60
  return defects.sort((a, b) => b.areaMm2 - a.areaMm2).slice(0, 60);
}

/**
 * 水印清晰度：浮雕区与非水印区的透射对比度（归一化 z 差），映射 0~100。
 */
export function watermarkClarity(f: FieldData, relief: Float32Array): number {
  const { mean, std } = fieldStats(f);
  let hi = 0;
  let lo = 0;
  let nHi = 0;
  let nLo = 0;
  for (let i = 0; i < relief.length; i++) {
    const v = f.field[i * 4];
    if (relief[i] > 18) {
      hi += v;
      nHi++;
    } else if (relief[i] < -18) {
      lo += v;
      nLo++;
    }
  }
  if (!nHi || !nLo) return 40;
  const contrast = Math.abs(lo / nLo - hi / nHi) / std;
  // z 差 0.6 -> 55，1.5 -> 90
  const score = 30 + 48 * (1 - Math.exp(-contrast / 0.9));
  return Math.round(Math.min(98, Math.max(10, score)));
}

/**
 * 干燥收缩：纵横向分别建模。
 * 打浆度越高、阔叶/棉比例越高收缩越大；MD/CD 各有经验系数。
 */
export function dryingShrink(recipe: PulpRecipe): { mdPct: number; cdPct: number } {
  const b = blendProperties(recipe);
  const cotton = recipe.components.find((c) => c.id === 'cotton')?.ratio ?? 0;
  const base = 0.9 + b.meanBeating * 0.045 + cotton * 0.012;
  // 横向收缩通常为纵向的 1.6~2 倍（纸机方向约束差异）
  return { mdPct: base, cdPct: base * 1.75 };
}

/** 收缩后水印尺寸漂移与公差判定 */
export function watermarkDrift(
  shrink: { mdPct: number; cdPct: number },
  tolerancePct = 1.5,
): SimResult['watermarkSizeDrift'] {
  return {
    mdPct: shrink.mdPct,
    cdPct: shrink.cdPct,
    tolerancePct,
    pass: shrink.mdPct <= tolerancePct && shrink.cdPct <= tolerancePct,
  };
}

/** 换种子稳定性自检：返回均值偏差百分比（应 ≤1%） */
export function seedStabilityCheck(results: { meanBasisWeight: number }[]): number {
  if (results.length < 2) return 0;
  const means = results.map((r) => r.meanBasisWeight);
  const avg = means.reduce((s, v) => s + v, 0) / means.length;
  const maxDev = Math.max(...means.map((m) => Math.abs(m - avg) / avg)) * 100;
  return maxDev;
}

/** 用确定性 RNG 生成基准样场（供对比曲线，不做真实仿真） */
export function syntheticReferenceField(f: FieldData, seed = 7): FieldData {
  const rng = new Rng(seed);
  const out = new Float32Array(f.field.length);
  const mean = 0;
  void mean;
  for (let i = 0; i < f.w * f.h; i++) {
    const n = rng.gaussian(90, 90 * 0.028);
    out[i * 4] = n;
    out[i * 4 + 1] = f.field[i * 4 + 1];
    out[i * 4 + 2] = f.field[i * 4 + 2];
    out[i * 4 + 3] = f.field[i * 4 + 3];
  }
  return { field: out, w: f.w, h: f.h, widthMm: f.widthMm, heightMm: f.heightMm };
}
