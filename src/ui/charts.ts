// ===== 轻量 Canvas 图表（零依赖）=====

export interface LineSeries {
  name: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
}

export function lineChart(
  canvas: HTMLCanvasElement,
  series: LineSeries[],
  opts: { xLabel?: string; yLabel?: string; title?: string; fillArea?: boolean } = {},
): void {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 520;
  const H = canvas.clientHeight || 260;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const padL = 52;
  const padR = 14;
  const padT = opts.title ? 28 : 12;
  const padB = 38;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      xMin = Math.min(xMin, p.x);
      xMax = Math.max(xMax, p.x);
      yMin = Math.min(yMin, p.y);
      yMax = Math.max(yMax, p.y);
    }
  }
  if (!isFinite(xMin)) return;
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad;
  yMax += yPad;

  const X = (x: number) => padL + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const Y = (y: number) => padT + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  // 网格 + 轴
  ctx.strokeStyle = '#2a3648';
  ctx.fillStyle = '#8fa0b5';
  ctx.lineWidth = 1;
  ctx.font = '11px sans-serif';
  const rows = 5;
  for (let i = 0; i <= rows; i++) {
    const yv = yMin + ((yMax - yMin) * i) / rows;
    const yy = Y(yv);
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(W - padR, yy);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(yv.toFixed(yv < 10 ? 2 : 1), padL - 7, yy + 4);
  }
  const cols = Math.min(8, series[0]?.points.length ?? 5);
  for (let i = 0; i <= cols; i++) {
    const xv = xMin + ((xMax - xMin) * i) / cols;
    const xx = X(xv);
    ctx.textAlign = 'center';
    ctx.fillText(xv.toFixed(xv < 10 ? 1 : 0), xx, H - padB + 16);
  }
  // 零轴
  if (yMin < 0 && yMax > 0) {
    ctx.strokeStyle = '#46586f';
    ctx.beginPath();
    ctx.moveTo(padL, Y(0));
    ctx.lineTo(W - padR, Y(0));
    ctx.stroke();
  }

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const xx = X(p.x);
      const yy = Y(p.y);
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    if (opts.fillArea && s.points.length) {
      ctx.lineTo(X(s.points[s.points.length - 1].x), Y(yMin));
      ctx.lineTo(X(s.points[0].x), Y(yMin));
      ctx.closePath();
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // 点
    ctx.fillStyle = s.color;
    for (const p of s.points) {
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 图例
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  let lx = padL;
  series.forEach((s) => {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, padT - 12, 14, 3);
    ctx.fillStyle = '#dce4ef';
    ctx.fillText(s.name, lx + 19, padT - 9);
    lx += ctx.measureText(s.name).width + 40;
  });
  if (opts.title) {
    ctx.fillStyle = '#dce4ef';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(opts.title, W - padR, 16);
  }
  if (opts.xLabel) {
    ctx.fillStyle = '#8fa0b5';
    ctx.textAlign = 'center';
    ctx.fillText(opts.xLabel, padL + plotW / 2, H - 4);
  }
}

export interface BarItem {
  label: string;
  value: number;
  color?: string;
  sub?: string;
}

export function barChart(
  canvas: HTMLCanvasElement,
  items: BarItem[],
  opts: { yLabel?: string; horizontal?: boolean; max?: number } = {},
): void {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 520;
  const H = canvas.clientHeight || 240;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const padL = 46;
  const padR = 12;
  const padT = 12;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = opts.max ?? Math.max(1, ...items.map((i) => i.value)) * 1.12;

  ctx.strokeStyle = '#2a3648';
  ctx.fillStyle = '#8fa0b5';
  ctx.font = '11px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    const yy = padT + plotH - (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(W - padR, yy);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(v < 10 ? 1 : 0), padL - 6, yy + 4);
  }

  const n = items.length;
  const slot = plotW / n;
  const bw = Math.min(46, slot * 0.62);
  items.forEach((it, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const bh = (it.value / max) * plotH;
    const y = padT + plotH - bh;
    ctx.fillStyle = it.color || '#4da3ff';
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = '#dce4ef';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(it.value.toFixed(it.value < 10 ? 2 : 1), x + bw / 2, y - 5);
    ctx.fillStyle = '#8fa0b5';
    const label = it.label.length > 7 ? it.label.slice(0, 6) + '…' : it.label;
    ctx.fillText(label, x + bw / 2, H - padB + 15);
  });
  if (opts.yLabel) {
    ctx.save();
    ctx.translate(13, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#8fa0b5';
    ctx.textAlign = 'center';
    ctx.fillText(opts.yLabel, 0, 0);
    ctx.restore();
  }
}

/** 多系列分组柱状（纤维长度分布） */
export function groupedHistogram(
  canvas: HTMLCanvasElement,
  edges: number[],
  series: { name: string; color: string; counts: number[] }[],
): void {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 560;
  const H = canvas.clientHeight || 250;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const padL = 48;
  const padR = 12;
  const padT = 24;
  const padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const bins = edges.length - 1;
  let max = 1;
  for (const s of series) for (const v of s.counts) max = Math.max(max, v);
  max *= 1.1;

  ctx.strokeStyle = '#2a3648';
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#8fa0b5';
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    const yy = padT + plotH - (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(W - padR, yy);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(v)), padL - 6, yy + 3);
  }

  const slot = plotW / bins;
  const groupW = slot * 0.8;
  const subW = groupW / series.length;
  for (let b = 0; b < bins; b++) {
    series.forEach((s, si) => {
      const v = s.counts[b];
      const bh = (v / max) * plotH;
      const x = padL + slot * b + (slot - groupW) / 2 + si * subW;
      ctx.fillStyle = s.color;
      ctx.fillRect(x, padT + plotH - bh, subW * 0.92, bh);
    });
  }
  ctx.fillStyle = '#8fa0b5';
  ctx.textAlign = 'center';
  for (let b = 0; b < bins; b += 3) {
    ctx.fillText(edges[b].toFixed(1), padL + slot * b + slot / 2, H - padB + 15);
  }
  ctx.fillText('纤维长度 mm', padL + plotW / 2, H - 6);
  // legend
  let lx = padL;
  ctx.font = '11px sans-serif';
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 8, 12, 10);
    ctx.fillStyle = '#dce4ef';
    ctx.textAlign = 'left';
    ctx.fillText(s.name, lx + 16, 17);
    lx += ctx.measureText(s.name).width + 34;
  }
}
