// 页面层公共工具，复用 lib/dom 并补充上传/画布快捷方法

export * from './dom';
export { drawHistogram, drawLineChart, basisColor } from './charts';
import { h } from './dom';
import { renderGrayField as renderGrayFieldBase } from './charts';

export function uploadBtn(label: string, onFile: (file: File) => void): HTMLElement {
  const input = h('input', { type: 'file', accept: 'image/*', style: 'display:none' }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) onFile(f);
    input.value = '';
  });
  const btn = h('button', { class: 'btn' }, label);
  btn.addEventListener('click', () => input.click());
  return h('div', { style: 'display:contents' }, btn, input);
}

export function renderGrayFieldSafe(canvas: HTMLCanvasElement, field: Float32Array, w: number, h: number, colorize: ((v: number, norm: number) => [number, number, number] | null) | null): void {
  // 大网格先降采样到预览尺寸，避免画布过大
  const maxDim = 700;
  if (Math.max(w, h) <= maxDim) {
    renderGrayFieldBase(canvas, field, w, h, colorize ?? undefined);
    return;
  }
  const scale = maxDim / Math.max(w, h);
  const pw = Math.round(w * scale);
  const ph = Math.round(h * scale);
  const small = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / scale));
      const sy = Math.min(h - 1, Math.floor(y / scale));
      small[y * pw + x] = field[sy * w + sx];
    }
  }
  renderGrayFieldBase(canvas, small, pw, ph, colorize ?? undefined);
}

export function tabs(tabDefs: { label: string; render: (host: HTMLElement) => void }[]): HTMLElement {
  const wrap = h('div', {});
  const bar = h('div', { class: 'tab-bar' });
  const host = h('div', {});
  tabDefs.forEach((t, i) => {
    const b = h('button', { class: i === 0 ? 'active' : '' }, t.label);
    b.addEventListener('click', () => {
      bar.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      host.replaceChildren();
      t.render(host);
    });
    bar.append(b);
  });
  wrap.append(bar, host);
  tabDefs[0].render(host);
  return wrap;
}
