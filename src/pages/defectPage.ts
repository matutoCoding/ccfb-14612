// ===== 页面 5：纸病分析 =====
import { h, clearEl, toast, fmt, gradePill, triggerDownload } from '../ui/dom';
import { getState, setState } from '../state';
import { loadSim, listSims } from '../db';
import type { DefectRecord } from '../types';

const KIND_META: Record<DefectRecord['kind'], { label: string; color: string; desc: string }> = {
  pinhole: { label: '针眼', color: '#f0645e', desc: '极薄区/透光孔洞，多发于浮雕陡边' },
  thinSpot: { label: '薄斑', color: '#f0a94b', desc: '局部低定量区域，透光偏亮' },
  floc: { label: '絮团', color: '#a487ff', desc: '纤维絮聚形成的高定量团块' },
  watermarkDistortion: { label: '水印走形', color: '#36d3c4', desc: '浮雕区内厚度调制失配，水印轮廓异常' },
};

export async function renderDefectPage(root: HTMLElement): Promise<void> {
  root.append(h('h2', { class: 'page-title' }, '纸病分析'), h('p', { class: 'page-sub' }, '基于定量场统计阈值 + 连通域自动识别针眼、薄斑、絮团与水印走形，按面积分级并在纸面上圈出。'));

  const state = getState();
  if (!state.sims.length) state.sims = await listSims();
  if (!state.sims.length) {
    root.append(h('div', { class: 'panel empty' }, '暂无仿真结果，请先到「抄造仿真」运行一次。'));
    return;
  }
  let simId = state.lastSimId && state.sims.some((s) => s.id === state.lastSimId) ? state.lastSimId! : state.sims[0].id;
  let sim = (await loadSim(simId))!;
  let filterKind: DefectRecord['kind'] | 'all' = 'all';

  const grid = h('div', { class: 'grid grid-2' });
  root.append(grid);
  const left = h('div', { class: 'panel' });
  const right = h('div');
  grid.append(left, right);

  function counts(): Record<string, number> {
    const c: Record<string, number> = { all: sim.defects.length, pinhole: 0, thinSpot: 0, floc: 0, watermarkDistortion: 0 };
    for (const d of sim.defects) c[d.kind]++;
    return c;
  }

  function renderLeft(): void {
    clearEl(left);
    left.append(h('h3', {}, '结果与筛选'));
    const sel = h<HTMLSelectElement>('select', {}, ...state.sims.map((s) => h('option', { value: s.id, selected: s.id === simId ? 'true' : null }, `${s.moldName} / ${s.recipeName} / 种子${s.params.seed}`)));
    sel.addEventListener('change', async () => {
      simId = sel.value;
      sim = (await loadSim(simId))!;
      setState({ lastSimId: simId, lastSimResult: sim });
      renderLeft();
      renderMap();
      renderTable();
    });
    left.append(h('label', { class: 'field' }, h('span', {}, '仿真结果'), sel));

    const c = counts();
    const sg = h('div', { class: 'stat-grid' });
    for (const k of ['pinhole', 'thinSpot', 'floc', 'watermarkDistortion'] as const) {
      sg.append(h('div', { class: 'stat' }, h('div', { class: 'k' }, KIND_META[k].label), h('div', { class: 'v', style: { color: KIND_META[k].color } }, String(c[k]), h('span', { class: 'u' }, '处'))));
    }
    left.append(sg);

    left.append(h('hr', { class: 'sep' }), h('h3', {}, '类型筛选'));
    const chips = h('div', { class: 'inline' });
    const opts: [DefectRecord['kind'] | 'all', string][] = [['all', `全部 ${c.all}`], ...((Object.keys(KIND_META) as DefectRecord['kind'][]).map((k) => [k, `${KIND_META[k].label} ${c[k]}`] as [DefectRecord['kind'], string]))];
    for (const [k, label] of opts) {
      const b = h('button', { class: 'sm' + (filterKind === k ? ' primary' : '') }, label);
      b.addEventListener('click', () => {
        filterKind = k;
        renderLeft();
        renderMap();
        renderTable();
      });
      chips.append(b);
    }
    left.append(chips);

    // 分级统计
    left.append(h('hr', { class: 'sep' }), h('h3', {}, '面积分级'));
    const g1 = sim.defects.filter((d) => d.grade === 1).length;
    const g2 = sim.defects.filter((d) => d.grade === 2).length;
    const g3 = sim.defects.filter((d) => d.grade === 3).length;
    left.append(
      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('div', { class: 'k' }, '1 级 轻微'), h('div', { class: 'v good' }, String(g1))),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, '2 级 中等'), h('div', { class: 'v warn' }, String(g2))),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, '3 级 严重'), h('div', { class: 'v bad' }, String(g3))),
      ),
    );
    left.append(h('div', { class: 'small', style: { marginTop: '10px' } }, '分级按等效面积（2 级/3 级阈值 mm²）：针眼 0.5/1.5，薄斑 3/6，絮团 4/8，走形 5/10。'));
  }

  const mapPanel = h('div', { class: 'panel' });
  const tablePanel = h('div', { class: 'panel' });
  right.append(mapPanel, tablePanel);

  function renderMap(): void {
    clearEl(mapPanel);
    mapPanel.append(h('h3', {}, '纸面纸病分布图'));
    if (!sim.thicknessField || !sim.gridW) {
      mapPanel.append(h('div', { class: 'empty' }, '场数据不在内存（历史记录仅存统计），请从仿真页重新运行或载入。'));
      return;
    }
    const canvas = h<HTMLCanvasElement>('canvas', { style: { width: '100%', maxHeight: '460px', imageRendering: 'pixelated', borderRadius: '8px' } });
    const w = sim.gridW;
    const hh = sim.gridH!;
    canvas.width = w;
    canvas.height = hh;
    const ctx = canvas.getContext('2d')!;
    // 底图：灰度定量
    const img = ctx.createImageData(w, hh);
    for (let i = 0; i < w * hh; i++) {
      const bw = sim.thicknessField[i * 4];
      const z = (bw - sim.meanBasisWeight) / sim.stdBasisWeight;
      const v = Math.round(200 - Math.max(-2.5, Math.min(2.5, z)) * 34);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // 圈纸病
    const pxPerMmX = w / sim.widthMm;
    const shown = sim.defects.filter((d) => filterKind === 'all' || d.kind === filterKind);
    for (const d of shown) {
      const meta = KIND_META[d.kind];
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = d.grade === 3 ? 3 : d.grade === 2 ? 2 : 1.2;
      ctx.beginPath();
      ctx.arc(d.cx * w, d.cy * hh, Math.max(3, d.radiusMm * pxPerMmX), 0, Math.PI * 2);
      ctx.stroke();
      if (d.grade === 3) {
        ctx.fillStyle = meta.color + '33';
        ctx.fill();
      }
    }
    mapPanel.append(canvas);
    const legend = h('div', { class: 'legend' });
    for (const k of Object.keys(KIND_META) as DefectRecord['kind'][]) {
      legend.append(h('span', {}, h('i', { style: { background: KIND_META[k].color } }, ''), `${KIND_META[k].label}：${KIND_META[k].desc}`));
    }
    mapPanel.append(legend);
    const btn = h('button', { class: 'sm ghost', style: { marginTop: '10px' } }, '导出标注图 PNG');
    btn.addEventListener('click', () => triggerDownload(canvas.toDataURL('image/png'), `defects_${simId}.png`));
    mapPanel.append(btn);
  }

  function renderTable(): void {
    clearEl(tablePanel);
    tablePanel.append(h('h3', {}, '纸病明细（按面积降序）'));
    const shown = sim.defects.filter((d) => filterKind === 'all' || d.kind === filterKind);
    if (!shown.length) {
      tablePanel.append(h('div', { class: 'empty' }, '当前筛选下无纸病 —— 纸面质量良好'));
      return;
    }
    const wrap = h('div', { class: 'table-wrap' });
    const table = h('table');
    table.append(h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, '类型'), h('th', {}, '位置 (x,y) mm'), h('th', {}, '等效半径 mm'), h('th', {}, '面积 mm²'), h('th', {}, '分级'))));
    const tb = h('tbody');
    shown.forEach((d, i) => {
      const tr = h('tr', { class: 'clickable' });
      tr.append(
        h('td', { class: 'muted' }, String(i + 1)),
        h('td', { style: { color: KIND_META[d.kind].color } }, KIND_META[d.kind].label),
        h('td', { class: 'num' }, `${fmt(d.cx * sim.widthMm, 1)}, ${fmt(d.cy * sim.heightMm, 1)}`),
        h('td', { class: 'num' }, fmt(d.radiusMm, 2)),
        h('td', { class: 'num' }, fmt(d.areaMm2, 2)),
        h('td', {}, gradePill(d.grade)),
      );
      tb.append(tr);
    });
    table.append(tb);
    wrap.append(table);
    tablePanel.append(wrap);
  }

  renderLeft();
  renderMap();
  renderTable();
}
