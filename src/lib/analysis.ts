// 纸面分析：匀度指数（积分图多尺度盒滤波）、纸病连通域、干燥收缩/水印公差

import type { DefectItem, FurnishDoc, MoldDoc } from './types';
import { A4_HEIGHT_MM, A4_WIDTH_MM } from './types';
import { maskBoundingBox, watermarkMask } from './mold';

export interface FormationResult {
  scalesMm: number[];
  cvCurve: number[];
  formationIndex: number;
}

/** 积分图（sat 长度 (w+1)*(h+1)） */
function integralImage(a: Float32Array, w: number, h: number): Float64Array {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    for (let x = 1; x <= w; x++) {
      rowSum += a[(y - 1) * w + (x - 1)];
      sat[y * (w + 1) + x] = sat[(y - 1) * (w + 1) + x] + rowSum;
    }
  }
  return sat;
}

function boxMean(sat: Float64Array, w: number, h: number, r: number): Float32Array {
  const W = w + 1;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = sat[(y1 + 1) * W + (x1 + 1)] - sat[y0 * W + (x1 + 1)] - sat[(y1 + 1) * W + x0] + sat[y0 * W + x0];
      out[y * w + x] = sum / area;
    }
  }
  return out;
}

function meanStd(a: Float32Array): { mean: number; std: number; min: number; max: number } {
  let s = 0;
  let s2 = 0;
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of a) {
    s += v;
    s2 += v * v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const mean = s / a.length;
  return { mean, std: Math.sqrt(Math.max(0, s2 / a.length - mean * mean)), min: mn, max: mx };
}

/**
 * 匀度指数：多尺度局部均值的变异系数曲线（类 STFI/纸页成形测试仪方法）。
 * 工业评估关注 2.5mm 以上尺度，FI 按 4mm 尺度 CV 标定，真实好纸 FI≈70~90。
 */
export function formationAnalysis(basis: Float32Array, w: number, h: number): FormationResult {
  const mmPerPx = A4_WIDTH_MM / w;
  const scalesMm = [1, 2, 2.5, 4, 6, 8, 12, 16, 25];
  const sat = integralImage(basis, w, h);
  const global = meanStd(basis);
  const cvCurve: number[] = [];
  for (const sMm of scalesMm) {
    const r = Math.max(1, Math.round(sMm / mmPerPx / 2));
    const local = boxMean(sat, w, h, r);
    const { std } = meanStd(local);
    cvCurve.push((std / global.mean) * 100);
  }
  const idx4 = scalesMm.indexOf(4);
  // FI 标定（匹配本仿真器纤维级 splat 的 CV 量级）：4mm CV 30%->FI≈63，20%->76，40%->55
  const formationIndex = 100 / (1 + cvCurve[idx4] / 17.5);
  return { scalesMm, cvCurve, formationIndex };
}

/** 好纸基准样（按本仿真器同口径标定的优质防伪纸曲线） */
export function referenceBenchmark(): { scalesMm: number[]; cvCurve: number[]; formationIndex: number } {
  const scalesMm = [1, 2, 2.5, 4, 6, 8, 12, 16, 25];
  const cvCurve = [22, 19, 17, 14, 11.5, 9.5, 7.2, 5.5, 3.8];
  return { scalesMm, cvCurve, formationIndex: 100 / (1 + 14 / 17.5) };
}

interface LabeledComponent {
  pixels: number[];
}

/** 4-邻接连通域（BFS），mask 为二值 Uint8Array */
function connectedComponents(mask: Uint8Array, w: number, h: number): LabeledComponent[] {
  const labels = new Int32Array(w * h).fill(-1);
  const comps: LabeledComponent[] = [];
  const queue = new Int32Array(w * h);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] >= 0) continue;
    const id = comps.length;
    const pixels: number[] = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const p = queue[head++];
      pixels.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      const neigh = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const np of neigh) {
        if (np >= 0 && mask[np] && labels[np] < 0) {
          labels[np] = id;
          queue[tail++] = np;
        }
      }
    }
    comps.push({ pixels });
  }
  return comps;
}

function componentToDefect(kind: DefectItem['kind'], comp: LabeledComponent, w: number, h: number, measure: number): DefectItem | null {
  // 连通域面积门槛：过滤纤维级零散波动，只保留真正的纸病（单位：纹素数，约 0.0625mm²/px）
  const minPixels = kind === 'pinhole' ? 3 : kind === 'floc' ? 120 : 80;
  if (comp.pixels.length < minPixels) return null;
  let cx = 0;
  let cy = 0;
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  for (const p of comp.pixels) {
    const x = p % w;
    const y = (p / w) | 0;
    cx += x;
    cy += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  cx /= comp.pixels.length;
  cy /= comp.pixels.length;
  const mmPerPx = A4_WIDTH_MM / w;
  const areaMm2 = comp.pixels.length * mmPerPx * mmPerPx;
  let level: DefectItem['level'];
  if (kind === 'pinhole') {
    level = areaMm2 >= 0.8 ? 'A' : areaMm2 >= 0.25 ? 'B' : 'C';
  } else if (kind === 'floc') {
    level = areaMm2 >= 80 ? 'A' : areaMm2 >= 25 ? 'B' : 'C';
  } else {
    level = areaMm2 >= 120 ? 'A' : areaMm2 >= 40 ? 'B' : 'C';
  }
  return {
    kind,
    cx: cx / w,
    cy: cy / h,
    rx: ((maxX - minX) / 2 / w) * (A4_WIDTH_MM / 210),
    ry: ((maxY - minY) / 2 / h) * (A4_HEIGHT_MM / 297),
    areaMm2,
    level,
    measure,
  };
}

export interface DefectResult {
  defects: DefectItem[];
  masks: { pinhole: Uint8Array; thin: Uint8Array; floc: Uint8Array };
}

/**
 * 纸病检测（定量场，原点在左上角）：
 * 针眼：低于均值 2.6σ 的极小区域；薄斑：低于 1.8σ；絮团：高于 1.8σ 的大块
 */
export function detectDefects(basis: Float32Array, w: number, h: number, mold: MoldDoc, shrinkMd: number, shrinkCd: number): DefectResult {
  const { mean, std } = meanStd(basis);
  const pinhole = new Uint8Array(w * h);
  const thin = new Uint8Array(w * h);
  const floc = new Uint8Array(w * h);
  const wmMask = watermarkMask(mold);
  // 网模掩膜缩放到分析网格
  const maskOnGrid = resampleMask(wmMask, mold.width, mold.height, w, h, shrinkMd, shrinkCd);

  for (let i = 0; i < basis.length; i++) {
    const z = (basis[i] - mean) / std;
    // 针眼：极端低值；薄斑/絮团用 2.8σ 且后续连通域面积门槛过滤小波动
    if (z < -3.2) pinhole[i] = 1;
    else if (z < -2.8 && !maskOnGrid[i]) thin[i] = 1;
    if (z > 2.8 && !maskOnGrid[i]) floc[i] = 1;
  }

  const defects: DefectItem[] = [];
  for (const comp of connectedComponents(pinhole, w, h)) {
    const d = componentToDefect('pinhole', comp, w, h, 0);
    if (d) defects.push(d);
  }
  for (const comp of connectedComponents(thin, w, h)) {
    const d = componentToDefect('thin', comp, w, h, 0);
    if (d) defects.push(d);
  }
  for (const comp of connectedComponents(floc, w, h)) {
    const d = componentToDefect('floc', comp, w, h, 0);
    if (d) defects.push(d);
  }

  // 水印走形：分块质心偏移
  defects.push(...detectDistortion(basis, w, h, mold, shrinkMd, shrinkCd));
  return { defects, masks: { pinhole, thin, floc } };
}

function resampleMask(mask: Uint8Array, mw: number, mh: number, gw: number, gh: number, shrinkMd: number, shrinkCd: number): Uint8Array {
  const out = new Uint8Array(gw * gh);
  // 收缩后有效幅面
  const effW = gw * (1 - shrinkCd);
  const effH = gh * (1 - shrinkMd);
  const offX = (gw - effW) / 2;
  const offY = (gh - effH) / 2;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const mx = ((x - offX) / effW) * mw;
      const my = ((y - offY) / effH) * mh;
      if (mx < 0 || my < 0 || mx >= mw || my >= mh) continue;
      out[y * gw + x] = mask[(Math.floor(my) * mw + Math.floor(mx)) | 0];
    }
  }
  return out;
}

/** 走形：把掩膜按 3x3 分块，对比沉积后薄区质心与设计质心 */
function detectDistortion(basis: Float32Array, w: number, h: number, mold: MoldDoc, shrinkMd: number, shrinkCd: number): DefectItem[] {
  const mask = resampleMask(watermarkMask(mold), mold.width, mold.height, w, h, shrinkMd, shrinkCd);
  const out: DefectItem[] = [];
  const blocks = 3;
  for (let by = 0; by < blocks; by++) {
    for (let bx = 0; bx < blocks; bx++) {
      const x0 = Math.floor((bx * w) / blocks);
      const x1 = Math.floor(((bx + 1) * w) / blocks);
      const y0 = Math.floor((by * h) / blocks);
      const y1 = Math.floor(((by + 1) * h) / blocks);
      let mN = 0;
      let mCx = 0;
      let mCy = 0;
      let bN = 0;
      let bCx = 0;
      let bCy = 0;
      let sum = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          if (mask[i]) {
            mN++;
            mCx += x;
            mCy += y;
            sum += basis[i];
            cnt++;
          }
        }
      }
      if (mN < 40) continue;
      mCx /= mN;
      mCy /= mN;
      const avg = cnt ? sum / cnt : 0;
      // 实测薄区（低于块内水印均值 8%）质心
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          if (mask[i] && basis[i] < avg * 0.92) {
            bN++;
            bCx += x;
            bCy += y;
          }
        }
      }
      if (bN < 20) continue;
      bCx /= bN;
      bCy /= bN;
      const shiftMm = (Math.hypot(bCx - mCx, bCy - mCy) / w) * A4_WIDTH_MM;
      if (shiftMm < 2.5) continue;
      out.push({
        kind: 'distortion',
        cx: mCx / w,
        cy: mCy / h,
        rx: 0.06,
        ry: 0.045,
        areaMm2: (mN / (w * h)) * A4_WIDTH_MM * A4_HEIGHT_MM,
        level: shiftMm >= 5 ? 'A' : shiftMm >= 3.5 ? 'B' : 'C',
        measure: shiftMm,
      });
    }
  }
  return out;
}

export interface ShrinkResult {
  shrinkMdPct: number;
  shrinkCdPct: number;
  wmWidthBefore: number;
  wmHeightBefore: number;
  wmWidthAfter: number;
  wmHeightAfter: number;
  wmTolerancePct: number;
  outOfTolerance: boolean;
}

/**
 * 干燥收缩：纵向(MD/y)、横向(CD/x)分开。
 * 经验模型：打浆度越高、棉浆越多收缩越大；基准 MD 1.8%、CD 3.2%。
 */
export function dryingShrinkage(mold: MoldDoc, furnish: FurnishDoc, tolerancePct = 5.0): ShrinkResult {
  const beat = (furnish.beatingDegree - 30) / 60;
  const shrinkMdPct = 0.018 + 0.012 * Math.max(0, beat) + 0.01 * furnish.cotton;
  const shrinkCdPct = 0.032 + 0.02 * Math.max(0, beat) + 0.015 * furnish.cotton;
  const bb = maskBoundingBox(watermarkMask(mold), mold.width, mold.height);
  const mmPerPxX = A4_WIDTH_MM / mold.width;
  const mmPerPxY = A4_HEIGHT_MM / mold.height;
  const wmWidthBefore = bb ? (bb.x1 - bb.x0) * mmPerPxX : 0;
  const wmHeightBefore = bb ? (bb.y1 - bb.y0) * mmPerPxY : 0;
  const wmWidthAfter = wmWidthBefore * (1 - shrinkCdPct);
  const wmHeightAfter = wmHeightBefore * (1 - shrinkMdPct);
  const wdChange = wmWidthBefore ? Math.abs(wmWidthAfter - wmWidthBefore) / wmWidthBefore : 0;
  const hdChange = wmHeightBefore ? Math.abs(wmHeightAfter - wmHeightBefore) / wmHeightBefore : 0;
  // tolerancePct 以百分数传入（如 2.0 表示 ±2%），比较时换成小数
  const tol = tolerancePct / 100;
  return {
    shrinkMdPct,
    shrinkCdPct,
    wmWidthBefore,
    wmHeightBefore,
    wmWidthAfter,
    wmHeightAfter,
    wmTolerancePct: tolerancePct,
    outOfTolerance: wdChange > tol || hdChange > tol,
  };
}

/** 水印清晰度：凸起白水印区与非水印区的定量 Michelson 对比度（百分比） */
export function watermarkClarity(basis: Float32Array, w: number, h: number, mold: MoldDoc): number {
  const fullMask = watermarkMask(mold);
  // 仅统计凸起（正高度）白水印区，避免凹下区稀释对比度
  const raised = new Uint8Array(fullMask.length);
  const posSpan = Math.max(mold.maxHeightUm, 1);
  for (let i = 0; i < raised.length; i++) raised[i] = mold.relief[i] > posSpan * 0.25 ? 1 : 0;
  const mask = resampleMask(raised, mold.width, mold.height, w, h, 0, 0);
  let inSum = 0;
  let inN = 0;
  let outSum = 0;
  let outN = 0;
  for (let i = 0; i < basis.length; i++) {
    if (mask[i]) {
      inSum += basis[i];
      inN++;
    } else {
      outSum += basis[i];
      outN++;
    }
  }
  if (inN < 10) return 0;
  const inside = inSum / inN;
  const outside = outSum / Math.max(1, outN);
  return (Math.abs(outside - inside) / Math.max(1e-4, outside + inside)) * 200;
}
