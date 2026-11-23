// 纤维沉积建模（CPU 侧，全确定性）：
// 随机取向 + 网模浮雕边缘导向 + 絮聚场（挂钩上网浓度/流速）+ 浮雕脱水差异
// 输出打包纤维数组与仿真网格上的浮雕场，交给 GPU splat

import type { FurnishDoc, MoldDoc, PackedFibers, SimParams } from './types';
import { A4_HEIGHT_MM, A4_WIDTH_MM } from './types';
import { Rng } from './rng';
import { sampleFiber } from './furnish';

export interface DepositionInput {
  mold: MoldDoc;
  furnish: FurnishDoc;
  params: SimParams;
}

export interface DepositionResult {
  fibers: PackedFibers;
  /** 仿真网格上的浮雕高度 um */
  reliefGrid: Float32Array;
  /** 仿真网格上的 x/y 梯度（um/px） */
  gradX: Float32Array;
  gradY: Float32Array;
  /** 絮聚场（均值 1） */
  flocField: Float32Array;
  /** 每根纤维的相对沉积权重（未归一化） */
  weightSum: number;
  gridW: number;
  gridH: number;
  mmPerPx: number;
}

/** 双线性重采样网模浮雕到仿真网格 */
export function resampleRelief(mold: MoldDoc, gw: number, gh: number): Float32Array {
  const out = new Float32Array(gw * gh);
  const sx = mold.width / gw;
  const sy = mold.height / gh;
  for (let y = 0; y < gh; y++) {
    const fy = y * sy;
    const y0 = Math.floor(fy);
    const yy = fy - y0;
    const y1 = Math.min(mold.height - 1, y0 + 1);
    for (let x = 0; x < gw; x++) {
      const fx = x * sx;
      const x0 = Math.floor(fx);
      const xx = fx - x0;
      const x1 = Math.min(mold.width - 1, x0 + 1);
      const a = mold.relief[y0 * mold.width + x0];
      const b = mold.relief[y0 * mold.width + x1];
      const c = mold.relief[y1 * mold.width + x0];
      const d = mold.relief[y1 * mold.width + x1];
      out[y * gw + x] = a * (1 - xx) * (1 - yy) + b * xx * (1 - yy) + c * (1 - xx) * yy + d * xx * yy;
    }
  }
  return out;
}

function computeGradients(relief: Float32Array, w: number, h: number): { gx: Float32Array; gy: Float32Array } {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      gx[i] = (relief[i + 1] - relief[i - 1]) * 0.5;
      gy[i] = (relief[i + w] - relief[i - w]) * 0.5;
    }
  }
  return { gx, gy };
}

/**
 * 絮聚场：粗网格值噪声 + 双线性上采样 + 两次平滑。
 * 上网浓度越高碰撞絮聚越强；流速越高絮团沿纵向（MD，y 向）拉伸。
 */
export function buildFlocField(gw: number, gh: number, consistency: number, flowSpeed: number, intensity: number, rng: Rng): Float32Array {
  const nx = 26;
  const ny = 38;
  // 浓度 0.1%..0.8% 映射到絮聚幅度；强度系数由用户调节
  const consFactor = Math.min(1.6, Math.max(0.4, consistency / 0.35));
  // 絮聚幅度克制：真实纸页大尺度定量波动通常只有几个百分点
  const amplitude = 0.38 * intensity * consFactor;
  // 流速 150..500 m/min -> MD 拉伸 1.2..2.6
  const stretch = 1.2 + Math.min(1.4, Math.max(0, (flowSpeed - 150) / 250));
  const coarse = new Float32Array(nx * ny);
  for (let i = 0; i < coarse.length; i++) coarse[i] = 1 + (rng.next() * 2 - 1) * amplitude;
  // 三次 3x3 平滑，形成连续柔和的絮团
  for (let pass = 0; pass < 3; pass++) {
    const tmp = new Float32Array(coarse.length);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(nx - 1, Math.max(0, x + dx));
            const yy = Math.min(ny - 1, Math.max(0, y + dy));
            sum += coarse[yy * nx + xx];
            n++;
          }
        }
        tmp[y * nx + x] = sum / n;
      }
    }
    coarse.set(tmp);
  }
  // 归一化回均值 1
  let mean = 0;
  for (const v of coarse) mean += v;
  mean /= coarse.length;
  for (let i = 0; i < coarse.length; i++) coarse[i] /= mean;

  const field = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    // MD(y) 方向除以拉伸系数 -> 絮团纵向拉长
    const fy = (y / gh) * ny / stretch;
    const y0 = Math.floor(fy) % ny;
    const yy = fy - Math.floor(fy);
    const y1 = (y0 + 1) % ny;
    for (let x = 0; x < gw; x++) {
      const fx = (x / gw) * nx;
      const x0 = Math.floor(fx) % nx;
      const xx = fx - Math.floor(fx);
      const x1 = (x0 + 1) % nx;
      const a = coarse[y0 * nx + x0];
      const b = coarse[y0 * nx + x1];
      const c = coarse[y1 * nx + x0];
      const d = coarse[y1 * nx + x1];
      field[y * gw + x] = a * (1 - xx) * (1 - yy) + b * xx * (1 - yy) + c * (1 - xx) * yy + d * xx * yy;
    }
  }
  return field;
}

function sampleField(field: Float32Array, w: number, h: number, x: number, y: number): number {
  const xi = Math.min(w - 1, Math.max(0, Math.floor(x)));
  const yi = Math.min(h - 1, Math.max(0, Math.floor(y)));
  return field[yi * w + xi];
}

/**
 * 生成全部纤维。打包布局（每根 8 float）：
 * [x1,y1,x2,y2, 单根质量(mg), 视觉宽(px), 浆种(0/1/2), 初始角(rad)]
 */
export function generateFibers(input: DepositionInput): DepositionResult {
  const { mold, furnish, params } = input;
  const { gridW: gw, gridH: gh, fiberCount, seed, mdOrientation } = params;
  const rng = new Rng(seed);
  const mmPerPx = A4_WIDTH_MM / gw;

  const reliefGrid = resampleRelief(mold, gw, gh);
  const { gx, gy } = computeGradients(reliefGrid, gw, gh);
  const flocField = buildFlocField(gw, gh, furnish.headboxConsistency, furnish.flowSpeed, params.flocIntensity, rng);

  const data = new Float32Array(fiberCount * 8);
  let weightSum = 0;
  const mdAngle = Math.PI / 2; // 纵向为 y 轴
  const orientSigma = (1 - mdOrientation) * 1.2 + 0.18;
  const maxAbsRelief = Math.max(Math.abs(mold.maxHeightUm), Math.abs(mold.minHeightUm), 1);

  for (let i = 0; i < fiberCount; i++) {
    const { species, lengthMm, coarseness } = sampleFiber(furnish, rng);
    // 纤维中心：均匀分布 + 亚像素抖动
    const cx = rng.next() * gw;
    const cy = rng.next() * gh;

    // 基础取向：包裹正态，集中在 MD 附近
    let angle = mdAngle + rng.gaussian() * orientSigma;
    // 浮雕边缘导向：沿等高线（梯度法向的垂直方向）偏转
    const ci = Math.min(gh - 1, Math.max(0, Math.floor(cy))) * gw + Math.min(gw - 1, Math.max(0, Math.floor(cx)));
    const slope = Math.hypot(gx[ci], gy[ci]) / mmPerPx; // um/mm
    const edgeBlend = Math.min(0.85, slope / 350);
    if (edgeBlend > 0.01) {
      const tangent = Math.atan2(-gx[ci], gy[ci]);
      // 角度差取最短弧
      let diff = tangent - angle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      angle += diff * edgeBlend;
    }

    const halfPx = lengthMm / (2 * mmPerPx);
    const x1 = cx - Math.cos(angle) * halfPx;
    const y1 = cy - Math.sin(angle) * halfPx;
    const x2 = cx + Math.cos(angle) * halfPx;
    const y2 = cy + Math.sin(angle) * halfPx;

    // 絮聚调权 + 浮雕脱水：凸起处脱水快、留着薄
    const floc = sampleField(flocField, gw, gh, cx, cy);
    const hn = reliefGrid[ci] / maxAbsRelief;
    const retention = 1 - 0.5 * hn; // hn>0 凸起 -> 脱水快、留着明显变薄（白水印）
    const relWeight = Math.max(0.05, lengthMm * coarseness * floc * retention);
    weightSum += relWeight;

    // 视觉宽度：纤维束高斯 splat，覆盖约 3.2~4px 平衡纤维感与网络搭接
    const widthPx = 3.2 + species * 0.3 + rng.next() * 0.6;

    const o = i * 8;
    data[o] = x1;
    data[o + 1] = y1;
    data[o + 2] = x2;
    data[o + 3] = y2;
    data[o + 4] = relWeight;
    data[o + 5] = widthPx;
    data[o + 6] = species;
    data[o + 7] = angle;
  }

  return {
    fibers: { data, count: fiberCount },
    reliefGrid,
    gradX: gx,
    gradY: gy,
    flocField,
    weightSum,
    gridW: gw,
    gridH: gh,
    mmPerPx,
  };
}

/** A4 面积 m2 */
export const SHEET_AREA_M2 = (A4_WIDTH_MM * A4_HEIGHT_MM) / 1e6;
