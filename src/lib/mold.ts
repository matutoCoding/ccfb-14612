// 网模设计：灰度图 -> 分档浮雕高度场，边缘陡度（针眼风险）分析

import type { MoldBand, MoldDoc } from './types';
import { nowTs, uid } from './types';
import { Rng } from './rng';

/** ImageData -> 归一化灰度（人眼亮度加权） */
export function toGray(img: ImageData): Float32Array {
  const { data, width, height } = img;
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    out[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  return out;
}

export function defaultBands(): MoldBand[] {
  // 三档：暗部凹下（黑水印）、中间平面、亮部凸起（白水印）
  return [
    { gray: 30, heightUm: -60 },
    { gray: 128, heightUm: 0 },
    { gray: 225, heightUm: 60 },
  ];
}

/** 按分档表做分段线性插值，输出浮雕高度 um */
export function applyBands(gray: Float32Array, bands: MoldBand[]): Float32Array {
  const sorted = [...bands].sort((a, b) => a.gray - b.gray);
  const out = new Float32Array(gray.length);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  for (let i = 0; i < gray.length; i++) {
    const g = gray[i] * 255;
    if (g <= lo.gray) {
      out[i] = lo.heightUm;
    } else if (g >= hi.gray) {
      out[i] = hi.heightUm;
    } else {
      for (let k = 0; k < sorted.length - 1; k++) {
        const a = sorted[k];
        const b = sorted[k + 1];
        if (g >= a.gray && g <= b.gray) {
          const t = (g - a.gray) / (b.gray - a.gray || 1);
          out[i] = a.heightUm + t * (b.heightUm - a.heightUm);
          break;
        }
      }
    }
  }
  return out;
}

export interface GradientResult {
  grad: Float32Array;
  /** 超过陡度阈值的像素索引 */
  riskPixels: Uint32Array;
  maxSlope: number;
}

/**
 * Sobel 梯度 -> 边缘陡度（um/mm 当量）。
 * 网模幅面按 A4 比例映射，像素物理尺寸 = 210/width mm。
 * 经验阈值：> 350 um/mm 的立面在抄造时纤维架桥，易出针眼。
 */
export function analyzeSlopes(relief: Float32Array, w: number, h: number, threshold = 350): GradientResult {
  const grad = new Float32Array(w * h);
  const mmPerPx = 210 / w;
  const risk: number[] = [];
  let maxSlope = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = relief[i - w - 1];
      const t = relief[i - w];
      const tr = relief[i - w + 1];
      const l = relief[i - 1];
      const r = relief[i + 1];
      const bl = relief[i + w - 1];
      const b = relief[i + w];
      const br = relief[i + w + 1];
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      const slope = Math.hypot(gx, gy) / (8 * mmPerPx);
      grad[i] = slope;
      if (slope > maxSlope) maxSlope = slope;
      if (slope > threshold) risk.push(i);
    }
  }
  return { grad, riskPixels: Uint32Array.from(risk), maxSlope };
}

export function buildMold(name: string, gray: Float32Array, width: number, height: number, bands: MoldBand[], note = '', parent: MoldDoc | null = null): MoldDoc {
  const relief = applyBands(gray, bands);
  const slope = analyzeSlopes(relief, width, height);
  let maxH = -Infinity;
  let minH = Infinity;
  for (const v of relief) {
    if (v > maxH) maxH = v;
    if (v < minH) minH = v;
  }
  return {
    id: uid('mold'),
    name,
    version: parent ? parent.version + 1 : 1,
    parentId: parent?.id ?? null,
    width,
    height,
    gray,
    bands: bands.map((b) => ({ ...b })),
    relief,
    maxHeightUm: maxH,
    minHeightUm: minH,
    pinholeRiskCount: slope.riskPixels.length,
    createdAt: nowTs(),
    note,
  };
}

/** 内置演示图案：椭圆水印 + 圆环 + 文字条带，无需外部图片 */
export function generateDemoPattern(w = 560, h = 792, variant: 'medallion' | 'text' | 'grid' = 'medallion'): { gray: Float32Array; width: number; height: number } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (variant === 'medallion') {
    // 亮椭圆（白水印凸起）
    const grad = ctx.createRadialGradient(w / 2, h * 0.32, 20, w / 2, h * 0.32, w * 0.36);
    grad.addColorStop(0, '#f2f2f2');
    grad.addColorStop(0.75, '#d8d8d8');
    grad.addColorStop(1, '#b0b0b0');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.32, w * 0.34, h * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 10;
    ctx.stroke();
    // 暗圆环（黑水印凹下）
    ctx.strokeStyle = '#2e2e2e';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.7, w * 0.26, h * 0.15, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#e8e8e8';
    ctx.font = `bold ${Math.round(w * 0.11)}px serif`;
    ctx.fillText('防伪', w / 2, h * 0.32);
  } else if (variant === 'text') {
    ctx.fillStyle = '#eaeaea';
    ctx.font = `bold ${Math.round(w * 0.13)}px serif`;
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.translate(w / 2, h * (0.18 + i * 0.16));
      ctx.rotate(-0.32);
      ctx.fillText('CERTIFICATE', 0, 0);
      ctx.restore();
    }
    ctx.fillStyle = '#333';
    ctx.font = `bold ${Math.round(w * 0.1)}px serif`;
    ctx.fillText('2026', w / 2, h * 0.9);
  } else {
    // 棋盘格 + 渐变圆，测试多档位
    const cells = 8;
    const cw = w / cells;
    const ch = h / Math.round(cells * (h / w));
    for (let y = 0; y < Math.round(h / ch); y++) {
      for (let x = 0; x < cells; x++) {
        const g = 60 + ((x + y) % 2) * 150;
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(x * cw, y * ch, cw, ch);
      }
    }
    const grad = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.4);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // 轻微确定性噪点，模拟原稿质感
  const img = ctx.getImageData(0, 0, w, h);
  const rng = new Rng(777);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng.next() - 0.5) * 10;
    img.data[i] = clamp8(img.data[i] + n);
    img.data[i + 1] = clamp8(img.data[i + 1] + n);
    img.data[i + 2] = clamp8(img.data[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
  return { gray: toGray(ctx.getImageData(0, 0, w, h)), width: w, height: h };
}

function clamp8(v: number): number {
  return Math.max(0, Math.min(255, v));
}

/** 提取水印掩膜：|浮雕高度| 超过最大幅度 25% 的区域，用于走形分析与收缩测量 */
export function watermarkMask(mold: MoldDoc): Uint8Array {
  const span = Math.max(Math.abs(mold.maxHeightUm), Math.abs(mold.minHeightUm), 1);
  const out = new Uint8Array(mold.relief.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.abs(mold.relief[i]) > span * 0.25 ? 1 : 0;
  }
  return out;
}

export function maskBoundingBox(mask: Uint8Array, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
