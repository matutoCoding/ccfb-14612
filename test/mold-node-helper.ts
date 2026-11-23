// Node 测试辅助：不依赖 canvas 的演示图案生成（与浏览器版视觉等效的纯数学灰度场）
import { Rng } from '../src/lib/rng';

export function generateDemoPatternNode(w: number, h: number, variant: 'medallion' | 'text' | 'grid'): { gray: Float32Array; width: number; height: number } {
  const gray = new Float32Array(w * h);
  const rng = new Rng(777);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x / w - 0.5) * 2;
      const ny = (y / h - 0.5) * 2;
      let g = 0.5;
      if (variant === 'medallion') {
        const e1 = (nx / 0.68) ** 2 + ((ny + 0.36) / 0.4) ** 2;
        if (e1 < 1) g = 0.88 - 0.18 * Math.sqrt(e1);
        const ring = Math.abs(Math.hypot(nx / 0.52, (ny - 0.4) / 0.3) - 1);
        if (ring < 0.08) g = 0.16;
      } else if (variant === 'text') {
        const band = Math.floor((ny + 1) * 5) % 2 === 0 && Math.abs(nx + ny * 0.6 - Math.round((nx + ny * 0.6) * 3) / 3) < 0.06;
        if (band) g = 0.9;
      } else {
        g = ((Math.floor(x / 35) + Math.floor(y / 35)) % 2) ? 0.82 : 0.24;
        const r = Math.hypot(nx, ny);
        g = Math.min(1, g + Math.max(0, 1 - r) * 0.5);
      }
      gray[y * w + x] = Math.max(0, Math.min(1, g + (rng.next() - 0.5) * 0.04));
    }
  }
  return { gray, width: w, height: h };
}
