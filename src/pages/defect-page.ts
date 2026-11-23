// 纸病分析页：在纸面上圈出四类纸病，按面积分级，支持类型/等级筛选

import { clear, fmt, h, renderGrayFieldSafe } from '../lib/page-utils';
import { basisColor } from '../lib/charts';
import { getState } from '../lib/session';
import type { DefectItem } from '../lib/types';

const KIND_META: Record<DefectItem['kind'], { label: string; color: string }> = {
  pinhole: { label: '针眼', color: '#e76f51' },
  thin: { label: '薄斑', color: '#f4a261' },
  floc: { label: '絮团', color: '#b39ddb' },
  distortion: { label: '水印走形', color: '#4ea8de' },
};

let kindFilter: DefectItem['kind'] | 'all' = 'all';
let levelFilter: DefectItem['level'] | 'all' = 'all';

export function renderDefectPage(root: HTMLElement): void {
  clear(root);
  const session = getState().lastSimulation;
  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, '纸病分析'), h('p', {}, '自动识别针眼、薄斑、絮团与水印走形，按面积分 A/B/C 三级；水印区域的天然偏薄不计薄斑。')),
  );
  if (!session) {
    root.append(h('div', { class: 'warn-box card' }, '请先运行抄造仿真。'));
    return;
  }

  const filtered = session.defects.filter((d) => (kindFilter === 'all' || d.kind === kindFilter) && (levelFilter === 'all' || d.level === levelFilter));

  const left = h('div', {});
  const right = h('div', {});
  root.append(h('div', { class: 'layout-2 narrow-left' }, left, right));

  // 筛选 + 统计
  const counts: Record<string, number> = { pinhole: 0, thin: 0, floc: 0, distortion: 0 };
  for (const d of session.defects) counts[d.kind]++;
  left.append(
    h('div', { class: 'card' }, h('h2', {}, '筛选'),
      filterRow('类型', [['all', '全部'], ...Object.entries(KIND_META).map(([k, m]) => [k, m.label] as [string, string])], kindFilter, (v) => { kindFilter = v as typeof kindFilter; renderDefectPage(document.querySelector('main')!); }),
      filterRow('等级', [['all', '全部'], ['A', 'A 级（严重）'], ['B', 'B 级'], ['C', 'C 级（轻微）']], levelFilter, (v) => { levelFilter = v as typeof levelFilter; renderDefectPage(document.querySelector('main')!); }),
    ),
    h('div', { class: 'card' }, h('h2', {}, '纸病统计'),
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, '类型'), h('th', {}, '数量'), h('th', {}, '判定阈值'))),
        h('tbody', {},
          h('tr', {}, h('td', {}, KIND_META.pinhole.label), h('td', {}, String(counts.pinhole)), h('td', {}, '定量 < 均值−3.2σ')),
          h('tr', {}, h('td', {}, KIND_META.thin.label), h('td', {}, String(counts.thin)), h('td', {}, '定量 < 均值−2.2σ')),
          h('tr', {}, h('td', {}, KIND_META.floc.label), h('td', {}, String(counts.floc)), h('td', {}, '定量 > 均值+2.2σ')),
          h('tr', {}, h('td', {}, KIND_META.distortion.label), h('td', {}, String(counts.distortion)), h('td', {}, '薄区质心偏移 > 2.5mm')),
        ),
      ),
      h('p', { class: 'muted', style: 'margin-top:8px' }, `当前筛选命中 ${filtered.length} 处。A 级针眼 ≥0.8mm²、薄斑/絮团 ≥80~120mm²。`),
    ),
    h('div', { class: 'card' }, h('h2', {}, '纸病明细（前 20 条）'),
      filtered.length === 0 ? h('p', { class: 'muted' }, '无命中纸病') :
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, '类型'), h('th', {}, '等级'), h('th', {}, '面积 mm²'), h('th', {}, '位置 x/y'))),
          h('tbody', {}, ...filtered.slice(0, 20).map((d) =>
            h('tr', {},
              h('td', {}, h('span', { class: 'badge badge-kind' }, KIND_META[d.kind].label)),
              h('td', {}, h('span', { class: `badge badge-${d.level}` }, d.level)),
              h('td', {}, fmt(d.areaMm2, 2)),
              h('td', {}, `${fmt(d.cx * 210, 1)} / ${fmt(d.cy * 297, 1)}`),
            ),
          )),
        ),
    ),
  );

  // 纸面 + 圈注
  const baseCanvas = h('canvas', {}) as HTMLCanvasElement;
  renderGrayFieldSafe(baseCanvas, session.basisGrid, session.gridW, session.gridH, basisColor);
  const overlay = h('canvas', { width: baseCanvas.width, height: baseCanvas.height }) as HTMLCanvasElement;
  const octx = overlay.getContext('2d')!;
  for (const d of filtered) {
    const meta = KIND_META[d.kind];
    octx.strokeStyle = meta.color;
    octx.lineWidth = Math.max(2, baseCanvas.width / 260);
    octx.beginPath();
    octx.ellipse(d.cx * baseCanvas.width, d.cy * baseCanvas.height, Math.max(3, d.rx * baseCanvas.width), Math.max(3, d.ry * baseCanvas.height), 0, 0, Math.PI * 2);
    octx.stroke();
    octx.fillStyle = meta.color;
    octx.font = `${Math.max(12, baseCanvas.width / 45)}px sans-serif`;
    octx.fillText(`${meta.label}${d.level}`, d.cx * baseCanvas.width + 4, d.cy * baseCanvas.height - 4);
  }

  right.append(
    h('div', { class: 'card' }, h('h2', {}, `纸面纸病分布图（${filtered.length} 处）`),
      h('div', { class: 'canvas-frame defect-overlay', style: 'position:relative' },
        h('div', { style: 'position:relative;display:flex;justify-content:center' }, baseCanvas, overlay),
      ),
      h('div', { style: 'display:flex;gap:14px;margin-top:10px;flex-wrap:wrap' },
        ...Object.entries(KIND_META).map(([k, m]) => h('span', { class: 'muted', style: `color:${m.color}` }, `● ${m.label} ${counts[k as DefectItem['kind']]}`)),
      ),
    ),
  );
  // overlay 覆盖定位
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.pointerEvents = 'none';
  const posWrap = baseCanvas.parentElement!;
  posWrap.style.position = 'relative';
  posWrap.style.width = 'fit-content';
  posWrap.style.maxWidth = '100%';
}

function filterRow(label: string, options: [string, string][], current: string, onChange: (v: string) => void): HTMLElement {
  const sel = h('select', {}) as HTMLSelectElement;
  for (const [v, l] of options) sel.append(h('option', { value: v, selected: v === current }, l));
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), sel);
}
