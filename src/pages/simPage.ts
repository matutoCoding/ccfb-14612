// ===== 页面 3：抄造仿真 =====
import { h, clearEl, toast, rangeField, fmt, fmtTime } from '../ui/dom';
import { listMolds, listRecipes, listSims, loadMold, loadSim, saveSim, deleteSim } from '../db';
import { getState, setState } from '../state';
import { runSimulation } from '../sim/orchestrator';
import { fieldStats, multiScaleCurve, referenceCurve, seedStabilityCheck } from '../sim/analysis';
import { lineChart } from '../ui/charts';
import type { BatchCompareRow, MoldDesign, PulpRecipe, SimResult } from '../types';

export async function renderSimPage(root: HTMLElement): Promise<void> {
  root.append(h('h2', { class: 'page-title' }, '抄造成形仿真'), h('p', { class: 'page-sub' }, '几十万根纤维经 GPU 实例化沉积到网面：浮雕高处脱水快沉积薄，絮聚随浓度/流速联动；同网模同浆料同种子结果逐位可复现。'));

  const state = getState();
  const [molds, recipes, sims] = await Promise.all([listMolds(), listRecipes(), listSims()]);
  state.molds = molds;
  state.recipes = recipes;
  state.sims = sims;

  if (!molds.length || !recipes.length) {
    root.append(h('div', { class: 'panel empty' }, '请先在「网模设计」保存网模方案、在「浆料配方」保存配方后再运行仿真。'));
    return;
  }

  const grid = h('div', { class: 'grid grid-2' });
  root.append(grid);
  const left = h('div', { class: 'panel' });
  const right = h('div');
  grid.append(left, right);

  let moldId = state.selectedMoldId && molds.some((m) => m.id === state.selectedMoldId) ? state.selectedMoldId! : molds[0].id;
  let recipeId = state.selectedRecipeId && recipes.some((r) => r.id === state.selectedRecipeId) ? state.selectedRecipeId! : recipes[0].id;
  let seed = 20261125;
  let fiberCount = 360000;
  let gridSize = 320;
  let randomness = 0.55;
  let running = false;

  // ---------- 参数面板 ----------
  function renderControls(): void {
    clearEl(left);
    left.append(h('h3', {}, '仿真任务配置'));
    const moldSel = h<HTMLSelectElement>('select', {}, ...molds.map((m) => h('option', { value: m.id, selected: m.id === moldId ? 'true' : null }, `${m.name} v${m.version}`)));
    const recipeSel = h<HTMLSelectElement>('select', {}, ...recipes.map((r) => h('option', { value: r.id, selected: r.id === recipeId ? 'true' : null }, r.name)));
    moldSel.addEventListener('change', () => (moldId = moldSel.value));
    recipeSel.addEventListener('change', () => (recipeId = recipeSel.value));
    left.append(
      h('label', { class: 'field' }, h('span', {}, '网模方案'), moldSel),
      h('label', { class: 'field' }, h('span', {}, '浆料配方'), recipeSel),
    );
    const seedIn = h<HTMLInputElement>('input', { type: 'number', value: String(seed), min: '1' });
    seedIn.addEventListener('input', () => (seed = Number(seedIn.value) >>> 0));
    left.append(h('label', { class: 'field' }, h('span', {}, '随机种子（同种子结果完全一致）'), seedIn));
    left.append(
      rangeField('纤维根数', fiberCount, 80000, 600000, 10000, ' 根', (v) => (fiberCount = v)).wrap,
      rangeField('沉积栅格（短边 px）', gridSize, 200, 480, 10, ' px', (v) => (gridSize = v)).wrap,
      rangeField('取向随机性', randomness, 0, 1, 0.05, '', (v) => (randomness = v)).wrap,
    );

    const progressWrap = h('div', { style: { margin: '12px 0' } });
    const bar = h('div', { class: 'progress' }, h('div'));
    const stage = h('div', { class: 'small', style: { marginTop: '6px' } }, '就绪');
    progressWrap.append(bar, stage);
    left.append(progressWrap);

    const btnRun = h<HTMLButtonElement>('button', { class: 'primary', style: { width: '100%' } }, '▶ 开始抄造仿真（GPU）');
    const btnReplay = h('button', { class: 'ghost sm', style: { width: '100%', marginTop: '8px' } }, '用相同种子复跑（验证可复现）');
    const btnSeed2 = h('button', { class: 'ghost sm', style: { width: '100%', marginTop: '8px' } }, '换 3 个种子连跑（验证均值偏差 ≤1%）');
    left.append(btnRun, btnReplay, btnSeed2);

    // 批量：同网模挂多浆料
    left.append(h('hr', { class: 'sep' }), h('h3', {}, '批量对比：同一网模 × 多浆料'));
    const btnBatch = h('button', { style: { width: '100%' } }, `批量跑全部 ${recipes.length} 个浆料方案`);
    left.append(btnBatch);

    btnRun.addEventListener('click', () => launch(seed, false));
    btnReplay.addEventListener('click', () => launch(seed, true));
    btnSeed2.addEventListener('click', () => multiSeedRun());
    btnBatch.addEventListener('click', () => batchRun());

    async function launch(useSeed: number, isReplay: boolean): Promise<void> {
      if (running) return;
      running = true;
      btnRun.disabled = true;
      try {
        const mold = await loadMold(moldId);
        if (!mold?.relief) throw new Error('网模浮雕缺失，请重新打开该方案');
        const recipe = recipes.find((r) => r.id === recipeId)!;
        const canvas = document.createElement('canvas');
        const { result, engine, fieldTex } = await runSimulation({
          canvas,
          mold,
          recipe,
          seed: useSeed,
          gridSize,
          fiberCount,
          orientationRandomness: randomness,
          onProgress: (p, s) => {
            (bar.firstElementChild as HTMLElement).style.width = `${Math.round(p * 100)}%`;
            stage.textContent = `${s}（${Math.round(p * 100)}%）`;
          },
        });
        await saveSim(result);
        state.sims = await listSims();
        setState({ lastSimResult: result, lastEngine: engine, lastFieldTex: fieldTex, lastSimId: result.id, selectedMoldId: moldId, selectedRecipeId: recipeId, sims: state.sims });
        renderResult(result, mold, isReplay);
        renderHistory();
        toast(`仿真完成：${fmt(result.elapsedMs / 1000, 1)}s，匀度 ${result.formationIndex}，纸病 ${result.defects.length} 处`, 'ok');
      } catch (e) {
        console.error(e);
        toast('仿真失败: ' + (e instanceof Error ? e.message : String(e)), 'err', 5000);
      } finally {
        running = false;
        btnRun.disabled = false;
      }
    }

    async function multiSeedRun(): Promise<void> {
      if (running) return;
      running = true;
      const rows: SimResult[] = [];
      const seeds = [seed, seed + 101, seed + 999];
      try {
        const mold = await loadMold(moldId);
        if (!mold?.relief) throw new Error('网模浮雕缺失');
        const recipe = recipes.find((r) => r.id === recipeId)!;
        for (const s of seeds) {
          stage.textContent = `种子 ${s} 运行中…`;
          const canvas = document.createElement('canvas');
          const { result } = await runSimulation({ canvas, mold, recipe, seed: s, gridSize, fiberCount, orientationRandomness: randomness, onProgress: (p, st2) => ((bar.firstElementChild as HTMLElement).style.width = `${Math.round(p * 100)}%`, (stage.textContent = `种子 ${s}：${st2}`)) });
          await saveSim(result);
          rows.push(result);
        }
        const dev = seedStabilityCheck(rows);
        state.sims = await listSims();
        setState({ sims: state.sims, lastSimResult: rows[0] });
        renderHistory();
        toast(`3 个种子平均定量最大偏差 ${fmt(dev, 3)}%（要求 ≤1%）${dev <= 1 ? ' ✔ 达标' : ' �’ 未达标'}`, dev <= 1 ? 'ok' : 'err', 6000);
      } catch (e) {
        toast('多种子运行失败: ' + String(e), 'err');
      } finally {
        running = false;
      }
    }

    async function batchRun(): Promise<void> {
      if (running) return;
      running = true;
      const table: BatchCompareRow[] = [];
      try {
        const mold = await loadMold(moldId);
        if (!mold?.relief) throw new Error('网模浮雕缺失');
        for (let i = 0; i < recipes.length; i++) {
          const recipe = recipes[i];
          stage.textContent = `批量 ${i + 1}/${recipes.length}：${recipe.name}`;
          const canvas = document.createElement('canvas');
          const { result } = await runSimulation({ canvas, mold, recipe, seed, gridSize, fiberCount, orientationRandomness: randomness, onProgress: (p) => ((bar.firstElementChild as HTMLElement).style.width = `${Math.round(((i + p) / recipes.length) * 100)}%`) });
          await saveSim(result);
          table.push({
            simId: result.id,
            recipeName: recipe.name,
            seed,
            formationIndex: result.formationIndex,
            clarity: result.clarity,
            defectTotal: result.defects.length,
            cvBasisWeight: result.cvBasisWeight,
            meanBasisWeight: result.meanBasisWeight,
            elapsedMs: result.elapsedMs,
          });
        }
        state.sims = await listSims();
        setState({ sims: state.sims });
        renderBatchTable(table);
        renderHistory();
        toast('批量对比完成', 'ok');
      } catch (e) {
        toast('批量失败: ' + String(e), 'err');
      } finally {
        running = false;
      }
    }
  }

  // ---------- 结果区 ----------
  const resultPanel = h('div', { class: 'panel' });
  const historyPanel = h('div', { class: 'panel' });
  const batchPanel = h('div', { class: 'panel' });
  right.append(resultPanel, batchPanel, historyPanel);

  function renderResult(r: SimResult, mold: MoldDesign, isReplay: boolean): void {
    clearEl(resultPanel);
    resultPanel.append(h('h3', {}, '仿真结果', h('span', { class: 'tag' }, `种子 ${r.params.seed} · ${fmt(r.elapsedMs / 1000, 1)}s · ${fmtTime(r.createdAt)}`)));
    const stats = h('div', { class: 'stat-grid' });
    stats.append(
      stat('平均定量', r.meanBasisWeight.toFixed(1), 'g/m²'),
      stat('定量波动 CV', r.cvBasisWeight.toFixed(2), '%', r.cvBasisWeight > 8 ? 'bad' : r.cvBasisWeight > 5 ? 'warn' : 'good'),
      stat('匀度指数', String(r.formationIndex), '分', r.formationIndex >= 75 ? 'good' : r.formationIndex >= 55 ? 'warn' : 'bad'),
      stat('水印清晰度', String(r.clarity), '分'),
      stat('纸病总数', String(r.defects.length), '处', r.defects.length > 20 ? 'bad' : r.defects.length > 8 ? 'warn' : 'good'),
    );
    resultPanel.append(stats);

    // 定量分布热力 canvas（直接用引擎渲染需要 GL 上下文；这里用 2D 从场画）
    const heatCanvas = h<HTMLCanvasElement>('canvas', { style: { width: '100%', maxHeight: '340px', marginTop: '12px', imageRendering: 'pixelated' } });
    resultPanel.append(heatCanvas);
    requestAnimationFrame(() => drawHeat(heatCanvas, r));
    resultPanel.append(h('div', { class: 'legend' }, h('span', {}, '蓝=薄区（低定量）'), h('span', {}, '绿=正常'), h('span', {}, '黄/红=厚区/絮团')));

    // 多尺度波动曲线 vs 基准
    const curveCanvas = h<HTMLCanvasElement>('canvas', { style: { width: '100%', height: '260px', marginTop: '12px' } });
    resultPanel.append(curveCanvas);
    requestAnimationFrame(() => {
      const ref = referenceCurve(r.meanBasisWeight);
      lineChart(curveCanvas, [
        { name: '本方案多尺度波动', color: '#4da3ff', points: r.scaleCurve.map((c) => ({ x: c.scaleMm, y: c.variance })) },
        { name: '好纸基准样', color: '#58d17a', dashed: true, points: ref.map((c) => ({ x: c.scaleMm, y: c.variance })) },
      ], { xLabel: '尺度 mm', yLabel: '定量方差 (g/m²)²', title: '不同尺度下的波动' });
    });

    // 收缩
    const d = r.watermarkSizeDrift;
    const shrink = h('div', { class: 'stat-grid', style: { marginTop: '12px' } });
    shrink.append(
      stat('纵向 MD 收缩', r.shrinkMD.toFixed(2), '%'),
      stat('横向 CD 收缩', r.shrinkCD.toFixed(2), '%', r.shrinkCD > d.tolerancePct ? 'bad' : ''),
      stat('水印 MD 尺寸漂移', d.mdPct.toFixed(2), '% 公差' + d.tolerancePct + '%', d.pass ? 'good' : 'bad'),
      stat('水印 CD 尺寸漂移', d.cdPct.toFixed(2), '%', d.pass ? 'good' : 'bad'),
    );
    resultPanel.append(shrink);
    if (!d.pass) resultPanel.append(h('div', { class: 'pill bad', style: { marginTop: '10px' } }, '水印干燥后尺寸漂移超出防伪图案公差，标红预警：建议降低打浆度或棉浆比例、调整干燥曲线'));
    if (isReplay) resultPanel.append(h('div', { class: 'pill good', style: { marginTop: '10px' } }, '同种子复跑完成，可与上一次结果逐位比对（场数据一致即证明可复现）'));

    // 边缘纤维走向提示
    resultPanel.append(h('div', { class: 'small', style: { marginTop: '10px' } }, '浮雕边缘纤维取向已在 GPU 顶点着色器中沿梯度切线带偏，可到「透光观察」查看边缘纹理走向。'));
  }

  function renderBatchTable(rows: BatchCompareRow[]): void {
    clearEl(batchPanel);
    batchPanel.append(h('h3', {}, '批量对比表（同网模 / 同种子）'));
    const wrap = h('div', { class: 'table-wrap' });
    const table = h('table');
    table.append(h('thead', {}, h('tr', {}, h('th', {}, '浆料方案'), h('th', {}, '匀度指数'), h('th', {}, '水印清晰度'), h('th', {}, '纸病数'), h('th', {}, '定量 CV%'), h('th', {}, '平均定量'), h('th', {}, '耗时 s'))));
    const tb = h('tbody');
    const best = Math.max(...rows.map((x) => x.formationIndex));
    for (const r of rows) {
      const tr = h('tr', { class: 'clickable' });
      tr.append(
        h('td', {}, r.recipeName + (r.formationIndex === best ? ' ★' : '')),
        h('td', { class: 'num ' + (r.formationIndex >= 75 ? 'good' : r.formationIndex >= 55 ? 'warn' : 'bad') }, String(r.formationIndex)),
        h('td', { class: 'num' }, String(r.clarity)),
        h('td', { class: 'num ' + (r.defectTotal > 20 ? 'bad' : r.defectTotal > 8 ? 'warn' : 'good') }, String(r.defectTotal)),
        h('td', { class: 'num' }, r.cvBasisWeight.toFixed(2)),
        h('td', { class: 'num' }, r.meanBasisWeight.toFixed(1)),
        h('td', { class: 'num muted' }, (r.elapsedMs / 1000).toFixed(1)),
      );
      tr.addEventListener('click', async () => {
        const full = await loadSim(r.simId);
        if (full?.thicknessField) {
          setState({ lastSimResult: full, lastSimId: full.id });
          toast('已载入该仿真结果，可到透光/纸病页查看', 'ok');
        }
      });
      tb.append(tr);
    }
    table.append(tb);
    wrap.append(table);
    batchPanel.append(wrap);
  }

  function renderHistory(): void {
    clearEl(historyPanel);
    historyPanel.append(h('h3', {}, '仿真历史（IndexedDB）', h('span', { class: 'tag' }, `${state.sims.length} 条`)));
    const wrap = h('div', { class: 'table-wrap' });
    const table = h('table');
    table.append(h('thead', {}, h('tr', {}, h('th', {}, '时间'), h('th', {}, '网模'), h('th', {}, '浆料'), h('th', {}, '种子'), h('th', {}, '匀度'), h('th', {}, '清晰度'), h('th', {}, '纸病'), h('th', {}, '操作'))));
    const tb = h('tbody');
    for (const r of state.sims.slice(0, 30)) {
      const tr = h('tr', { class: 'clickable' + (state.lastSimId === r.id ? ' selected' : '') });
      tr.append(
        h('td', { class: 'muted' }, fmtTime(r.createdAt)),
        h('td', {}, r.moldName),
        h('td', {}, r.recipeName),
        h('td', { class: 'num' }, String(r.params.seed)),
        h('td', { class: 'num' }, String(r.formationIndex)),
        h('td', { class: 'num' }, String(r.clarity)),
        h('td', { class: 'num' }, String(r.defects.length)),
        h('td', {}, (() => {
          const b = h('button', { class: 'sm danger' }, '删除');
          b.addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteSim(r.id);
            state.sims = await listSims();
            renderHistory();
          });
          return b;
        })()),
      );
      tr.addEventListener('click', async () => {
        const full = await loadSim(r.id);
        if (full) {
          setState({ lastSimResult: full, lastSimId: full.id });
          const mold = await loadMold(full.params.moldId);
          renderResult(full, mold ?? ({} as MoldDesign), false);
          renderHistory();
          toast('已载入历史仿真', 'ok');
        }
      });
      tb.append(tr);
    }
    table.append(tb);
    wrap.append(table);
    historyPanel.append(wrap);
  }

  renderControls();
  if (state.lastSimResult) renderResult(state.lastSimResult, molds.find((m) => m.id === state.lastSimResult!.params.moldId) ?? ({} as MoldDesign), false);
  renderHistory();
}

function stat(k: string, v: string, u: string, cls = ''): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + cls }, v, h('span', { class: 'u' }, u)));
}

/** 2D 伪彩定量分布图（从厚度场直接绘制） */
function drawHeat(canvas: HTMLCanvasElement, r: SimResult): void {
  const field = r.thicknessField!;
  const w = r.gridW!;
  const h = r.gridH!;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const mean = r.meanBasisWeight;
  for (let i = 0; i < w * h; i++) {
    const bw = field[i * 4];
    let t = (bw - mean * 0.72) / (mean * 0.56);
    t = Math.min(1, Math.max(0, t));
    const [rr, gg, bb] = heatColor(t);
    img.data[i * 4] = rr;
    img.data[i * 4 + 1] = gg;
    img.data[i * 4 + 2] = bb;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
function heatColor(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [26, 46, 107]],
    [0.25, [38, 140, 191]],
    [0.5, [89, 217, 140]],
    [0.75, [242, 217, 89]],
    [1, [242, 89, 64]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return [Math.round(c0[0] + (c1[0] - c0[0]) * k), Math.round(c0[1] + (c1[1] - c0[1]) * k), Math.round(c0[2] + (c1[2] - c0[2]) * k)];
    }
  }
  return stops[stops.length - 1][1];
}
