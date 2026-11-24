// ===== 通用 UI 工具 =====
import { uid } from '../db';

export function h<T extends HTMLElement = HTMLElement>(
  tag: string,
  attrs: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined | false)[]
): T {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'dataset' && typeof v === 'object') {
      Object.assign(el.dataset, v);
    } else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el as T;
}

export function clearEl(el: HTMLElement): void {
  el.replaceChildren();
}

export function toast(msg: string, kind: 'ok' | 'err' | 'info' = 'info', ms = 2600): void {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    document.body.append(wrap);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  wrap.append(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity .3s';
    setTimeout(() => t.remove(), 320);
  }, ms);
}

export function fmt(n: number, digits = 2): string {
  if (!isFinite(n)) return '—';
  return n.toFixed(digits);
}
export function pct(n: number, digits = 1): string {
  return `${fmt(n, digits)}%`;
}
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  triggerDownload(URL.createObjectURL(blob), filename);
}
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsText(file);
  });
}
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });
}
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

export function newId(prefix: string): string {
  return uid(prefix);
}

/** 滑块字段 */
export function rangeField(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  unit = '',
  onChange: (v: number) => void,
): { wrap: HTMLElement; input: HTMLInputElement; val: HTMLElement } {
  const val = h('b', {}, `${fmt(value, step < 1 ? 2 : 0)}${unit}`);
  const input = h<HTMLInputElement>('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = `${fmt(v, step < 1 ? 2 : 0)}${unit}`;
    onChange(v);
  });
  const wrap = h('label', { class: 'field' }, h('span', {}, document.createTextNode(label), val), input);
  return { wrap, input, val };
}

/** 简易模态框 */
export function modal(title: string, content: Node, footer?: Node): () => void {
  const mask = h('div', { class: 'modal-mask' });
  const close = () => mask.remove();
  const m = h(
    'div',
    { class: 'modal' },
    h('h3', {}, title),
    content,
    footer ? h('div', { class: 'btn-row', style: { justifyContent: 'flex-end' } }, footer) : null,
  );
  mask.append(m);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  document.body.append(mask);
  return close;
}

/** canvas -> PNG dataURL（缩小到指定最长边） */
export function canvasThumb(canvas: HTMLCanvasElement, maxEdge = 480): string {
  const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * scale));
  c.height = Math.max(1, Math.round(canvas.height * scale));
  c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

export function gradePill(grade: 1 | 2 | 3): HTMLElement {
  const map = { 1: ['good', '轻微'], 2: ['warn', '中等'], 3: ['bad', '严重'] } as const;
  const [cls, txt] = map[grade];
  return h('span', { class: `pill ${cls}` }, txt);
}
