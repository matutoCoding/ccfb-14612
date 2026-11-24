// ===== 灰度图 -> 网模浮雕高度场 =====
import type { MoldDesign, ReliefLevel } from '../types';
import { Rng } from './rng';

export const DEFAULT_LEVELS: ReliefLevel[] = [
  { id: 'lv1', grayMin: 0.0, grayMax: 0.2, heightUm: -45, label: '深凹（黑水印）' },
  { id: 'lv2', grayMin: 0.2, grayMax: 0.4, heightUm: -22, label: '浅凹' },
  { id: 'lv3', grayMin: 0.4, grayMax: 0.6, heightUm: 0, label: '纸面基准' },
  { id: 'lv4', grayMin: 0.6, grayMax: 0.8, heightUm: 22, label: '浅凸' },
  { id: 'lv5', grayMin: 0.8, grayMax: 1.01, heightUm: 45, label: '高凸（白水印）' },
];

/** 从图片抽取灰度场（缩放到 gridW×gridH），输出 [0,1] Float32Array */
export function imageToGray(img: HTMLImageElement, gridW: number, gridH: number): Float32Array {
  const c = document.createElement('canvas');
  c.width = gridW;
  c.height = gridH;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, gridW, gridH);
  const data = ctx.getImageData(0, 0, gridW, gridH).data;
  const gray = new Float32Array(gridW * gridH);
  for (let i = 0; i < gray.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    // ITU-R BT.601 亮度
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  return gray;
}

/** 内置测试图案（无图片时生成：徽章 + 文字 + 边框） */
export function builtinGrayPattern(gridW: number, gridH: number, seed: number): Float32Array {
  const gray = new Float32Array(gridW * gridH).fill(0.5);
  const rng = new Rng(seed);
  const cx = gridW / 2;
  const cy = gridH / 2;
  const r0 = Math.min(gridW, gridH) * 0.32;

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const dx = (x - cx) / r0;
      const dy = (y - cy) / r0;
      const d = Math.sqrt(dx * dx + dy * dy);
      let v = 0.5;
      // 外圈凸环（白水印）
      if (d > 0.86 && d < 0.98) v = 0.88;
      // 内圈凹环（黑水印）
      else if (d > 0.72 && d < 0.78) v = 0.16;
      // 中心凸徽
      else if (d < 0.42) v = 0.82;
      // 星形凹纹
      const ang = Math.atan2(dy, dx);
      const star = Math.cos(ang * 5) * 0.18;
      if (d < 0.42 && d > Math.abs(star) + 0.08) v = 0.2;
      gray[y * gridW + x] = v;
    }
  }
  // 模拟文字条带（底部三行字，用高对比块状图案代替）
  const bandY = Math.round(gridH * 0.78);
  for (let row = 0; row < 3; row++) {
    const y0 = bandY + row * Math.max(3, Math.round(gridH * 0.035));
    let x = Math.round(gridW * 0.2);
    const r2 = rng.fork(row + 11);
    while (x < gridW * 0.8) {
      const w = 2 + Math.floor(r2.next() * 5);
      const on = r2.next() > 0.35;
      if (on) {
        for (let y = y0; y < Math.min(gridH, y0 + Math.max(2, gridH * 0.022)); y++) {
          for (let xx = x; xx < Math.min(gridW, x + w); xx++) gray[y * gridW + xx] = 0.85;
        }
      }
      x += w + 1 + Math.floor(r2.next() * 2);
    }
  }
  // 轻微高斯模糊，让边缘更像扫描灰度图
  return boxBlur(gray, gridW, gridH, 1);
}

/** 灰度场 + 分档 -> 浮雕高度场（μm），相邻档之间线性过渡（过渡带由 softness 控制） */
export function grayToRelief(gray: Float32Array, levels: ReliefLevel[], softness = 0.06): Float32Array {
  const sorted = [...levels].sort((a, b) => a.grayMin - b.grayMin);
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const g = gray[i];
    let lv = sorted[0];
    for (const l of sorted) {
      if (g >= l.grayMin && g < l.grayMax) {
        lv = l;
        break;
      }
    }
    out[i] = lv.heightUm;
    // 边界附近线性混合，避免硬台阶（真实网模雕刻有过渡圆角）
    for (const l of sorted) {
      const edge = l.grayMin;
      if (edge <= 0) continue;
      const dist = Math.abs(g - edge);
      if (dist < softness) {
        const other = sorted.find((x) => x.grayMax === edge || x.grayMin === edge);
        if (other) {
          const t = 1 - dist / softness;
          out[i] = out[i] * (1 - t * 0.5) + other.heightUm * (t * 0.5);
        }
      }
    }
  }
  return out;
}

export function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src.slice();
  let tmp = src.slice();
  const out = new Float32Array(src.length);
  for (let pass = 0; pass < 1; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < w) {
            sum += tmp[y * w + xx];
            n++;
          }
        }
        out[y * w + x] = sum / n;
      }
    }
    tmp = out.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < h) {
            sum += tmp[yy * w + x];
            n++;
          }
        }
        out[y * w + x] = sum / n;
      }
    }
    tmp = out;
  }
  return out;
}

export interface PinholeRisk {
  count: number;
  fraction: number;
  /** 风险位置（归一化坐标），供页面标记 */
  points: { x: number; y: number; steepness: number }[];
}

/**
 * 针眼风险：浮雕梯度过陡（高度突变 / 栅格距离 > 阈值）的格子。
 * 经验阈值：单格高度落差 > 30μm 即提示，> 45μm 高风险。
 */
export function detectPinholeRisk(relief: Float32Array, w: number, h: number): PinholeRisk {
  const points: PinholeRisk['points'] = [];
  const THRESH = 30;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = relief[i + 1] - relief[i - 1];
      const gy = relief[i + w] - relief[i - w];
      const steep = Math.sqrt(gx * gx + gy * gy) * 0.5;
      if (steep > THRESH) {
        points.push({ x: x / w, y: y / h, steepness: steep });
      }
    }
  }
  // 密度太高时抽样显示，避免标记糊成一片
  const display = points.length > 400 ? points.filter((_, i) => i % Math.ceil(points.length / 400) === 0) : points;
  return { count: points.length, fraction: points.length / (w * h), points: display };
}

/** 浮雕场渲染为彩色预览 canvas（蓝=凹 白=平 红=凸） */
export function renderReliefCanvas(relief: Float32Array, w: number, h: number, risk?: PinholeRisk): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  let maxAbs = 1;
  for (const v of relief) maxAbs = Math.max(maxAbs, Math.abs(v));
  for (let i = 0; i < relief.length; i++) {
    const t = relief[i] / maxAbs; // -1..1
    const p = i * 4;
    if (t >= 0) {
      img.data[p] = Math.round(180 + 75 * t);
      img.data[p + 1] = Math.round(190 + 60 * t);
      img.data[p + 2] = Math.round(210 + 40 * t);
    } else {
      img.data[p] = Math.round(90 + 60 * (1 + t));
      img.data[p + 1] = Math.round(130 + 70 * (1 + t));
      img.data[p + 2] = Math.round(200 + 45 * (1 + t));
    }
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (risk) {
    ctx.strokeStyle = 'rgba(240,100,94,.9)';
    ctx.fillStyle = 'rgba(240,100,94,.25)';
    ctx.lineWidth = 1;
    const rr = Math.max(2, w / 180);
    for (const pt of risk.points) {
      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * h, pt.steepness > 45 ? rr * 1.4 : rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  return c;
}

/** 灰度原图预览 */
export function renderGrayCanvas(gray: Float32Array, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < gray.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, gray[i])) * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function gridSizeFor(widthMm: number, heightMm: number, res: number): { w: number; h: number } {
  // res = 每 100mm 栅格数
  const w = Math.round((widthMm / 100) * res);
  const h = Math.round((heightMm / 100) * res);
  return { w: Math.max(32, w), h: Math.max(32, h) };
}

export function makeMoldDraft(name: string): MoldDesign {
  const now = Date.now();
  return {
    id: `mold_${now.toString(36)}`,
    name,
    version: 1,
    createdAt: now,
    updatedAt: now,
    widthMm: 210,
    heightMm: 297,
    gridRes: 120,
    levels: DEFAULT_LEVELS.map((l) => ({ ...l })),
  };
}
