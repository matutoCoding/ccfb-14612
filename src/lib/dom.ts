// 极简 DOM 构建工具，避免引入框架

export type ElChild = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListenerOrEventListenerObject | undefined> = {},
  ...children: ElChild[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'value') {
      (el as HTMLInputElement).value = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function mount(el: HTMLElement, node: Node): void {
  el.replaceChildren(node);
}

export function labeledField(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('small', { class: 'field-hint' }, hint) : undefined);
}

export function numInput(value: number, step: number, min: number, max: number, onInput: (v: number) => void): HTMLInputElement {
  const input = h('input', { type: 'number', step, min, max, value }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onInput(v);
  });
  return input;
}

export function slider(value: number, min: number, max: number, step: number, onInput: (v: number) => void): HTMLInputElement {
  const input = h('input', { type: 'range', min, max, step, value }) as HTMLInputElement;
  input.addEventListener('input', () => onInput(parseFloat(input.value)));
  return input;
}

export function selectEl(options: { value: string; label: string }[], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const sel = h('select', {}) as HTMLSelectElement;
  for (const o of options) {
    sel.append(h('option', { value: o.value, selected: o.value === value }, o.label));
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

export function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  return h('button', { class: primary ? 'btn btn-primary' : 'btn', onClick }, label);
}

export function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(n: number, digits = 2): string {
  return `${fmt(n * 100, digits)}%`;
}

export function toast(msg: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2600);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = h('a', { href: dataUrl, download: filename }) as HTMLAnchorElement;
  document.body.append(a);
  a.click();
  a.remove();
}

export function readImageFile(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxDim = 1400;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(64, Math.round(img.width * scale));
      const h = Math.max(64, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
