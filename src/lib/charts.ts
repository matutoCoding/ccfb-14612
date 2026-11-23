// Canvas 折线图/直方图工具（无第三方依赖）

export interface CurveSeries {
  label: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
}

export function drawLineChart(canvas: HTMLCanvasElement, series: CurveSeries[], opts: { xLabel: string; yLabel: string; title?: string }): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 600;
  const cssH = canvas.clientHeight || 320;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW;
  const H = cssH;
  ctx.clearRect(0, 0, W, H);
  const padL = 56;
  const padR = 16;
  const padT = opts.title ? 34 : 14;
  const padB = 46;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return;
  const xMin = Math.min(...all.map((p) => p.x));
  const xMax = Math.max(...all.map((p) => p.x));
  const yMin = Math.min(...all.map((p) => p.y));
  const yMax = Math.max(...all.map((p) => p.y));
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  // 网格与坐标
  ctx.strokeStyle = 'var(--border)';
  ctx.fillStyle = 'var(--text-dim)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.lineWidth = 1;
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const y = padT + (plotH * i) / yTicks;
    const val = yMax - (yRange * i) / yTicks;
    ctx.strokeStyle = getCss('--border');
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(val.toFixed(2), 8, y + 4);
  }
  const xTicks = Math.min(6, all.length);
  for (let i = 0; i <= xTicks; i++) {
    const val = xMin + (xRange * i) / xTicks;
    const x = padL + (plotW * i) / xTicks;
    ctx.fillText(val.toFixed(1), x - 10, H - padB + 18);
  }
  // 轴
  ctx.strokeStyle = getCss('--text-dim');
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const x = padL + ((p.x - xMin) / xRange) * plotW;
      const y = padT + (1 - (p.y - yMin) / yRange) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 图例
  let lx = padL;
  ctx.font = '12px system-ui, sans-serif';
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, padT - 14, 18, 3);
    ctx.fillStyle = getCss('--text');
    ctx.fillText(s.label, lx + 22, padT - 10);
    lx += ctx.measureText(s.label).width + 44;
  }
  ctx.fillStyle = getCss('--text-dim');
  ctx.fillText(opts.xLabel, padL + plotW / 2 - 20, H - 8);
  ctx.save();
  ctx.translate(14, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(opts.yLabel, -20, 0);
  ctx.restore();
  if (opts.title) {
    ctx.fillStyle = getCss('--text');
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(opts.title, padL, 16);
  }
}

export function drawHistogram(canvas: HTMLCanvasElement, bins: { lo: number; hi: number; count: number }[], series: { label: string; color: string }[]): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 600;
  const cssH = canvas.clientHeight || 240;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (bins.length === 0) return;
  const maxCount = Math.max(...bins.map((b) => b.count));
  const padL = 48;
  const padB = 38;
  const padT = 12;
  const plotW = cssW - padL - 12;
  const plotH = cssH - padT - padB;
  const bw = plotW / bins.length;
  ctx.fillStyle = series[0]?.color ?? getCss('--accent');
  bins.forEach((b, i) => {
    const h = (b.count / maxCount) * plotH;
    ctx.fillRect(padL + i * bw + 1, padT + plotH - h, bw - 2, h);
  });
  ctx.fillStyle = getCss('--text-dim');
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(bins[0].lo.toFixed(2), padL, cssH - 18);
  ctx.fillText(bins[bins.length - 1].hi.toFixed(2), cssW - 60, cssH - 18);
  ctx.fillText('纤维长度 mm', padL + plotW / 2 - 30, cssH - 4);
}

function getCss(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

/** 灰度场 -> 彩色 canvas（带可选色带） */
export function renderGrayField(canvas: HTMLCanvasElement, field: Float32Array, w: number, h: number, colorize: ((v: number, norm: number) => [number, number, number] | null) | null = null): void {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of field) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1;
  for (let i = 0; i < field.length; i++) {
    const norm = (field[i] - lo) / range;
    let r: number;
    let g: number;
    let b: number;
    if (colorize) {
      const c = colorize(field[i], norm);
      if (c) {
        [r, g, b] = c;
      } else {
        const g8 = Math.round(norm * 255);
        r = g = b = g8;
      }
    } else {
      const g8 = Math.round(norm * 255);
      r = g = b = g8;
    }
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** 定量热力色带：蓝(薄)->青->绿->黄->红(厚) */
export function basisColor(_v: number, norm: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [40, 70, 160]],
    [0.25, [40, 170, 200]],
    [0.5, [90, 190, 110]],
    [0.75, [230, 200, 70]],
    [1, [210, 70, 50]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (norm <= t1) {
      const k = (norm - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}
