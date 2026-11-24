// ===== 页面 2：浆料配方 =====
import { h, clearEl, toast, fmtTime, rangeField } from '../ui/dom';
import { deleteRecipe, listRecipes, newId, saveRecipe } from '../db';
import { getState, setState } from '../state';
import type { FiberComponent, PulpRecipe } from '../types';
import {
  blendProperties,
  flocculationLevel,
  lengthDistributionHistogram,
  makeDefaultRecipe,
  ratioSum,
} from '../sim/pulp';
import { barChart, groupedHistogram, lineChart } from '../ui/charts';

const COLORS = ['#4da3ff', '#36d3c4', '#a487ff'];

export async function renderPulpPage(root: HTMLElement): Promise<void> {
  root.append(h('h2', { class: 'page-title' }, '浆料配方'), h('p', { class: 'page-sub' }, '针叶 / 阔叶 / 棉浆分组设置纤维长度、粗度、打浆度；长度分布按对数正态程序生成，絮聚程度随上网浓度与流速联动。'));

  const state = getState();
  state.recipes = await listRecipes();
  let current: PulpRecipe = state.recipes[0] ? JSON.parse(JSON.stringify(state.recipes[0])) : makeDefaultRecipe();
  let saved = state.recipes.some((r) => r.id === current.id);

  const grid = h('div', { class: 'grid grid-2' });
  root.append(grid);
  const left = h('div', { class: 'panel' });
  const right = h('div');
  grid.append(left, right);

  // ---- 列表 ----
  function renderList(): void {
    clearEl(left);
    left.append(h('h3', {}, '配方库', h('span', { class: 'tag' }, `${state.recipes.length} 个`)));
    const btnNew = h('button', { class: 'primary sm', style: { width: '100%', marginBottom: '10px' } }, '＋ 新建配方');
    btnNew.addEventListener('click', () => {
      current = makeDefaultRecipe(`配方 ${state.recipes.length + 1}`);
      saved = false;
      renderEditor();
      renderAnalytics();
    });
    left.append(btnNew);
    const list = h('div', { class: 'side-list' });
    if (!state.recipes.length) list.append(h('div', { class: 'empty' }, '暂无配方'));
    for (const r of state.recipes) {
      const item = h('div', { class: 'list-item' + (r.id === current.id ? ' sel' : '') });
      item.append(h('div', { class: 't' }, r.name), h('div', { class: 's' }, `目标定量 ${r.targetBasisWeight} g/m² · 浓度 ${r.headboxConsistency}% · ${fmtTime(r.updatedAt)}`));
      item.addEventListener('click', () => {
        current = JSON.parse(JSON.stringify(r));
        saved = true;
        renderList();
        renderEditor();
        renderAnalytics();
      });
      list.append(item);
    }
    left.append(list);
  }

  // ---- 编辑 ----
  const editor = h('div', { class: 'panel' });
  const analytics = h('div', { class: 'panel' });
  right.append(editor, analytics);

  function renderEditor(): void {
    clearEl(editor);
    const r = current;
    editor.append(h('h3', {}, '配方参数', saved ? h('span', { class: 'pill good' }, '已保存') : h('span', { class: 'pill warn' }, '未保存')));
    const nameIn = h<HTMLInputElement>('input', { type: 'text', value: r.name });
    nameIn.addEventListener('input', () => (r.name = nameIn.value));
    editor.append(h('label', { class: 'field' }, h('span', {}, '配方名称'), nameIn));

    // 三种纤维组元
    for (let ci = 0; ci < r.components.length; ci++) {
      const c = r.components[ci];
      const box = h('div', { style: { background: 'var(--bg-input)', border: `1px solid var(--border)`, borderRadius: '9px', padding: '10px 12px', marginBottom: '10px' } });
      box.append(h('div', { class: 'inline', style: { justifyContent: 'space-between', marginBottom: '6px' } }, h('b', { style: { color: COLORS[ci] } }, c.name), h('span', { class: 'small' }, `配比权重 ${c.ratio}%`)));
      box.append(
        rangeField('配比 %', c.ratio, 0, 100, 1, '%', (v) => {
          c.ratio = v;
          updateSumLine();
          renderAnalytics();
        }).wrap,
      );
      const row = h('div', { class: 'row3' });
      row.append(
        numField('平均长度 mm', c.meanLengthMm, 0.1, 18, 0.1, (v) => (c.meanLengthMm = v)),
        numField('粗度 mg/m', c.coarsenessMgPerM, 0.02, 0.5, 0.01, (v) => (c.coarsenessMgPerM = v)),
        numField('打浆度 °SR', c.beatingDegreeSR, 10, 90, 1, (v) => (c.beatingDegreeSR = v)),
      );
      box.append(row);
      box.append(rangeField('长度分布 CV', c.lengthCv, 0.1, 0.9, 0.01, '', (v) => (c.lengthCv = v)).wrap);
      editor.append(box);
    }

    const sum = ratioSum(r);
    const sumLine = h('span', { class: sum > 105 || sum < 95 ? 'bad' : 'dim' }, `配比合计：${sum.toFixed(1)}%（应≈100%）`);
    editor.append(h('div', { class: 'inline', style: { marginBottom: '10px' } }, sumLine));
    const updateSumLine = (): void => {
      const s = ratioSum(r);
      sumLine.textContent = `配比合计：${s.toFixed(1)}%（应≈100%）`;
      sumLine.className = s > 105 || s < 95 ? 'bad' : 'dim';
    };

    editor.append(
      rangeField('上网浓度', r.headboxConsistency, 0.1, 1.5, 0.05, ' %', (v) => {
        r.headboxConsistency = v;
        renderAnalytics();
      }).wrap,
      rangeField('上网流速', r.jetSpeed, 20, 120, 1, ' m/min', (v) => {
        r.jetSpeed = v;
        renderAnalytics();
      }).wrap,
      rangeField('絮聚系数（基础值）', r.flocBase, 0, 1, 0.01, '', (v) => {
        r.flocBase = v;
        renderAnalytics();
      }).wrap,
      rangeField('目标定量', r.targetBasisWeight, 40, 200, 1, ' g/m²', (v) => {
        r.targetBasisWeight = v;
        renderAnalytics();
      }).wrap,
    );

    const btnSave = h('button', { class: 'primary' }, '保存配方');
    btnSave.addEventListener('click', async () => {
      r.updatedAt = Date.now();
      if (!saved) {
        r.id = newId('recipe');
        r.createdAt = Date.now();
      }
      await saveRecipe(r);
      state.recipes = await listRecipes();
      setState({ recipes: state.recipes, selectedRecipeId: r.id });
      saved = true;
      toast('配方已保存', 'ok');
      renderList();
      renderEditor();
    });
    const btnCopy = h('button', { class: 'ghost' }, '复制为新配方');
    btnCopy.addEventListener('click', () => {
      current = { ...JSON.parse(JSON.stringify(r)), id: newId('recipe'), name: r.name + ' 副本', createdAt: Date.now(), updatedAt: Date.now() };
      saved = false;
      renderList();
      renderEditor();
      renderAnalytics();
    });
    const btnDel = h<HTMLButtonElement>('button', { class: 'danger' }, '删除');
    btnDel.disabled = !saved;
    btnDel.addEventListener('click', async () => {
      await deleteRecipe(r.id);
      state.recipes = await listRecipes();
      current = state.recipes[0] ? JSON.parse(JSON.stringify(state.recipes[0])) : makeDefaultRecipe();
      saved = state.recipes.some((x) => x.id === current.id);
      toast('已删除', 'ok');
      renderList();
      renderEditor();
      renderAnalytics();
    });
    editor.append(h('div', { class: 'btn-row' }, btnSave, btnCopy, btnDel));
  }

  // ---- 分析图表 ----
  function renderAnalytics(): void {
    clearEl(analytics);
    const r = current;
    const b = blendProperties(r);
    const floc = flocculationLevel(r);
    analytics.append(h('h3', {}, '群体属性与长度分布'));

    const stats = h('div', { class: 'stat-grid' });
    stats.append(
      miniStat('混合平均长度', b.meanLength.toFixed(2), 'mm'),
      miniStat('混合长度 CV', (b.blendCv * 100).toFixed(1), '%'),
      miniStat('平均粗度', b.meanCoarseness.toFixed(3), 'mg/m'),
      miniStat('平均打浆度', b.meanBeating.toFixed(1), '°SR'),
      miniStat('实际絮聚程度', (floc * 100).toFixed(0), '%', floc > 0.55 ? 'bad' : floc > 0.35 ? 'warn' : 'good'),
    );
    analytics.append(stats);

    const histCanvas = h<HTMLCanvasElement>('canvas', { style: { width: '100%', height: '250px', marginTop: '14px' } });
    const blendCanvas = h<HTMLCanvasElement>('canvas', { style: { width: '100%', height: '220px', marginTop: '10px' } });
    const flocCanvas = h<HTMLCanvasElement>('canvas', { style: { width: '100%', height: '200px', marginTop: '10px' } });
    analytics.append(histCanvas, blendCanvas, flocCanvas);
    requestAnimationFrame(() => {
      const hist = lengthDistributionHistogram(r, 12345);
      groupedHistogram(
        histCanvas,
        hist.edges,
        r.components.map((c, i) => ({ name: c.name, color: COLORS[i], counts: hist.perComponent[i] })),
      );
      barChart(
        blendCanvas,
        r.components.map((c, i) => ({ label: c.name, value: c.ratio, color: COLORS[i] })),
        { yLabel: '配比 %', max: 100 },
      );
      // 絮聚敏感性：浓度扫描
      const scan: { x: number; y: number }[] = [];
      const saved2 = r.headboxConsistency;
      for (let c = 0.2; c <= 1.4; c += 0.15) {
        r.headboxConsistency = c;
        scan.push({ x: c, y: flocculationLevel(r) });
      }
      r.headboxConsistency = saved2;
      lineChart(flocCanvas, [{ name: '絮聚程度随上网浓度变化', color: '#f0a94b', points: scan }], { xLabel: '上网浓度 %', yLabel: '絮聚指数' });
    });
  }

  renderList();
  renderEditor();
  renderAnalytics();
}

function numField(label: string, value: number, min: number, max: number, step: number, on: (v: number) => void): HTMLElement {
  const inp = h<HTMLInputElement>('input', { type: 'number', value: String(value), min: String(min), max: String(max), step: String(step) });
  inp.addEventListener('input', () => on(Number(inp.value)));
  return h('label', { class: 'field' }, h('span', { style: { fontSize: '11px' } }, label), inp);
}
function miniStat(k: string, v: string, u: string, cls = ''): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + cls }, v, h('span', { class: 'u' }, u)));
}
