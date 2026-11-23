// 抄造仿真页：运行 / 定量分布 / 匀度 / 收缩 / 批量对比 / 复现性校验

import { getEngine } from '../engine-singleton';
import { dbPut, listFurnishes, listSims } from '../lib/db';
import { button, clear, drawLineChart, fmt, h, labeledField, numInput, pct, renderGrayFieldSafe, slider, toast } from '../lib/page-utils';
import { basisColor } from '../lib/charts';
import { runSimulation } from '../lib/simulation';
import { getState, setSimulation } from '../lib/session';
import { referenceBenchmark } from '../lib/analysis';
import { DEFAULT_SIM_PARAMS, type FurnishDoc, type SimParams, type SimSessionData } from '../lib/types';

let params: SimParams = { ...DEFAULT_SIM_PARAMS };
let running = false;

export function renderSimulationPage(root: HTMLElement): void {
  clear(root);
  const mold = getState().currentMold;
  const furnish = getState().currentFurnish;
  const session = getState().lastSimulation;

  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, '抄造仿真'), h('p', {}, '几十万根纤维按随机取向沉积到网面，GPU 实例化 splat 计算定量/厚度场；同网模同浆料同种子逐位复现。')),
  );

  if (!mold || !furnish) {
    root.append(h('div', { class: 'warn-box card' }, '请先在「网模设计」和「浆料配方」页选择当前网模与浆料。'));
    return;
  }

  const left = h('div', {});
  const right = h('div', {});
  root.append(h('div', { class: 'layout-2 narrow-left' }, left, right));
  renderControls(left);
  renderResults(right, session);
}

function renderControls(left: HTMLElement): void {
  clear(left);
  const card = h('div', { class: 'card' }, h('h2', {}, '仿真参数'));

  card.append(
    labeledField(`随机种子（${params.seed}）`, slider(params.seed, 1, 99999999, 1, (v) => {
      params.seed = Math.round(v);
      renderControls(left);
    })),
    h('div', { class: 'btn-row' },
      button('换种子 +1', () => { params.seed = (params.seed + 1) >>> 0; renderControls(left); }),
      button('输入种子', () => {
        const v = window.prompt('输入随机种子（整数）', String(params.seed));
        if (v !== null) {
          const n = parseInt(v, 10);
          if (Number.isFinite(n)) { params.seed = n >>> 0; renderControls(left); }
        }
      }),
    ),
    labeledField('纤维数量', numInput(params.fiberCount, 10000, 50000, 1000000, (v) => { params.fiberCount = Math.round(v); })),
    labeledField('仿真网格 W×H', h('div', { class: 'muted' }, `${params.gridW} × ${params.gridH}（A4 比例，0.25mm/px）`)),
    labeledField(`絮聚强度（${fmt(params.flocIntensity, 2)}）`, slider(params.flocIntensity, 0, 1, 0.05, (v) => { params.flocIntensity = v; renderControls(left); })),
    labeledField(`纵向取向偏好（${fmt(params.mdOrientation, 2)}）`, slider(params.mdOrientation, 0, 1, 0.05, (v) => { params.mdOrientation = v; renderControls(left); })),
  );

  const progressBox = h('div', { style: 'margin:10px 0' });
  const runBtn = button('开始抄造仿真', () => void doRun(progressBox), true);
  card.append(h('div', { class: 'btn-row' }, runBtn), progressBox);
  left.append(card);

  // 批量与复现
  const batchCard = h('div', { class: 'card' }, h('h2', {}, '批量与复现性'));
  batchCard.append(
    h('p', { class: 'muted' }, '同一网模挂多个浆料方案批量跑；同种子重跑校验指纹一致；换 5 个种子统计平均定量偏差（要求 ≤1%）。'),
    h('div', { class: 'btn-row' },
      button('同模多浆批量跑', () => void doBatch(batchCard), true),
      button('复现性校验', () => void doReproCheck(batchCard)),
      button('换种子偏差测试', () => void doSeedSweep(batchCard)),
    ),
    h('div', { class: 'batch-out', style: 'margin-top:10px' }),
  );
  left.append(batchCard);

  // 历史记录
  void listSims().then((sims) => {
    const histCard = h('div', { class: 'card' }, h('h2', {}, `历史仿真（${sims.length}）`));
    if (sims.length === 0) {
      histCard.append(h('p', { class: 'muted' }, '暂无记录'));
    } else {
      sims.sort((a, b) => b.createdAt - a.createdAt);
      histCard.append(...sims.slice(0, 8).map((s) =>
        h('div', { class: 'list-item' },
          h('div', {}, h('div', {}, s.name), h('div', { class: 'meta mono' }, `指纹 ${s.fingerprint.slice(0, 10)}… · ${fmt(s.stats.elapsedMs / 1000, 1)}s`)),
          h('div', { class: 'meta' }, `${fmt(s.stats.meanBasisWeight, 1)}g/m²`),
        ),
      ));
    }
    left.append(histCard);
  });
}

async function doRun(progressBox: HTMLElement): Promise<void> {
  if (running) return;
  running = true;
  const mold = getState().currentMold!;
  const furnish = getState().currentFurnish!;
  progressBox.replaceChildren();
  const bar = h('div', { class: 'progress-wrap' }, h('div', { class: 'bar' }));
  const msg = h('div', { class: 'muted' }, '准备中…');
  progressBox.append(bar, msg);
  try {
    const engine = getEngine();
    const session = await runSimulation({
      mold,
      furnish,
      params,
      engine,
      onProgress: (m, r) => {
        (bar.firstChild as HTMLElement).style.width = `${r * 100}%`;
        msg.textContent = m;
      },
    });
    setSimulation(session);
    await dbPut('sims', session.record);
    toast(`仿真完成，用时 ${fmt(session.record.stats.elapsedMs / 1000, 1)}s`);
    renderSimulationPage(document.querySelector('main')!);
  } catch (e) {
    progressBox.append(h('div', { class: 'danger-box', style: 'margin-top:8px' }, `仿真失败：${(e as Error).message}`));
  } finally {
    running = false;
  }
}

function renderResults(right: HTMLElement, session: SimSessionData | null): void {
  clear(right);
  if (!session) {
    right.append(h('div', { class: 'card' }, h('h2', {}, '仿真结果'), h('p', { class: 'muted' }, '设置参数后点击「开始抄造仿真」。A4 幅面 30 万纤维普通笔记本目标 30 秒内完成。')));
    return;
  }
  const { stats } = session.record;
  const bench = referenceBenchmark();

  const tabHost = h('div', {});
  right.append(tabHost);

  const tabs = [
    {
      label: '定量分布',
      render: (host: HTMLElement) => {
        const canvas = h('canvas', {}) as HTMLCanvasElement;
        renderGrayFieldSafe(canvas, session.basisGrid, session.gridW, session.gridH, basisColor);
        host.append(
          h('div', { class: 'card' }, h('h2', {}, '定量分布图（g/m² 热力）'),
            h('div', { class: 'canvas-frame' }, canvas),
            h('div', { class: 'stat-grid', style: 'margin-top:10px' },
              stat('平均定量', `${fmt(stats.meanBasisWeight, 2)}`, 'g/m²'),
              stat('标准差', `${fmt(stats.stdBasisWeight, 2)}`, 'g/m²'),
              stat('变异系数 CV', `${fmt(stats.cvPercent, 2)}%`, stats.cvPercent < 8 ? 'good' : 'warn'),
              stat('最小/最大', `${fmt(stats.minBw, 1)} / ${fmt(stats.maxBw, 1)}`, 'g/m²'),
            ),
            h('p', { class: 'muted', style: 'margin-top:8px' }, '浮雕凸起处脱水快、留着薄（偏蓝）；絮团区域偏红。颜色按全局均值±σ 拉伸。'),
          ),
        );
      },
    },
    {
      label: '匀度曲线',
      render: (host: HTMLElement) => {
        const cv = h('canvas', { style: 'width:100%;height:320px' }) as HTMLCanvasElement;
        requestAnimationFrame(() =>
          drawLineChart(
            cv,
            [
              { label: '本样品', color: '#4ea8de', points: session.scaleCurve.scalesMm.map((x, i) => ({ x, y: session.scaleCurve.cvCurve[i] })) },
              { label: '好纸基准样', color: '#57cc99', dashed: true, points: bench.scalesMm.map((x, i) => ({ x, y: bench.cvCurve[i] })) },
            ],
            { xLabel: '尺度 mm', yLabel: 'CV %', title: '不同尺度下的定量波动' },
          ),
        );
        host.append(
          h('div', { class: 'card' }, h('h2', {}, '匀度指数（多尺度 STFI 类方法）'),
            cv,
            h('div', { class: 'stat-grid', style: 'margin-top:10px' },
              stat('匀度指数 FI', fmt(stats.formationIndex, 1), stats.formationIndex >= bench.formationIndex ? 'good' : 'warn'),
              stat('好纸基准 FI', fmt(bench.formationIndex, 1), ''),
              stat('2.5mm 尺度 CV', `${fmt(session.scaleCurve.cvCurve[session.scaleCurve.scalesMm.indexOf(2.5)], 2)}%`, ''),
              stat('水印清晰度', `${fmt(stats.clarity, 1)}%`, stats.clarity > 12 ? 'good' : 'warn'),
            ),
          ),
        );
      },
    },
    {
      label: '干燥收缩',
      render: (host: HTMLElement) => {
        const out = stats.wmOutOfTolerance ? 'bad' : 'good';
        host.append(
          h('div', { class: 'card' }, h('h2', {}, '干燥收缩与水印尺寸变化'),
            h('div', { class: 'stat-grid' },
              stat('纵向 MD 收缩', pct(stats.shrinkMdPct), ''),
              stat('横向 CD 收缩', pct(stats.shrinkCdPct), ''),
              stat('水印宽 湿→干', `${fmt(stats.wmWidthBefore, 1)} → ${fmt(stats.wmWidthAfter, 1)} mm`, ''),
              stat('水印高 湿→干', `${fmt(stats.wmHeightBefore, 1)} → ${fmt(stats.wmHeightAfter, 1)} mm`, ''),
            ),
            h('div', { style: 'margin-top:12px' },
              stats.wmOutOfTolerance
                ? h('div', { class: 'danger-box' }, `尺寸变化超出防伪图案公差 ±${fmt(stats.wmTolerancePct, 1)}%，该网模/浆料组合判为不合格，建议降低打浆度或棉浆比例。`)
                : h('div', { class: 'ok-box' }, `尺寸变化在防伪图案公差 ±${fmt(stats.wmTolerancePct, 1)}% 以内。`),
            ),
            h('p', { class: 'muted', style: 'margin-top:8px' }, '收缩模型：基准 MD 1.8% / CD 3.2%，随打浆度与棉浆比例上升；纵横向分别计算。'),
          ),
        );
        void out;
      },
    },
    {
      label: '批量对比',
      render: (host: HTMLElement) => {
        host.append(h('div', { class: 'card' }, h('h2', {}, '同网模多浆料批量对比'), h('p', { class: 'muted' }, '在左侧点击「同模多浆批量跑」，结果表显示在此处。'), h('div', { class: 'batch-table-host' })));
      },
    },
    {
      label: '仿真信息',
      render: (host: HTMLElement) => {
        host.append(
          h('div', { class: 'card' }, h('h2', {}, '运行信息与数据指纹'),
            h('table', { class: 'data' },
              h('tbody', {},
                infoRow('网模', `${session.mold.name} v${session.mold.version}`),
                infoRow('浆料', session.furnish.name),
                infoRow('种子', String(session.record.params.seed)),
                infoRow('纤维数', session.record.params.fiberCount.toLocaleString('zh-CN')),
                infoRow('网格', `${session.gridW} × ${session.gridH}`),
                infoRow('用时', `${fmt(stats.elapsedMs / 1000, 2)} 秒`),
                infoRow('指纹', session.record.fingerprint, true),
              ),
            ),
            h('p', { class: 'muted', style: 'margin-top:8px' }, '指纹由定量场全部浮点字节哈希生成；同网模同浆料同种子重跑，指纹必须完全相同。'),
          ),
        );
      },
    },
  ];

  const bar = h('div', { class: 'tab-bar' });
  tabs.forEach((t, i) => {
    const b = h('button', { class: i === 0 ? 'active' : '' }, t.label);
    b.addEventListener('click', () => {
      bar.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      tabHost.replaceChildren();
      t.render(tabHost);
      if (t.label === '批量对比') renderBatchTable(tabHost.querySelector('.batch-table-host') as HTMLElement);
    });
    bar.append(b);
  });
  tabHost.append(bar);
  tabs[0].render(tabHost);
}

let batchRows: { furnish: string; fi: number; clarity: number; defects: number; cv: number; elapsed: number }[] = [];

async function doBatch(card: HTMLElement): Promise<void> {
  if (running) return;
  const mold = getState().currentMold!;
  const all = await listFurnishes();
  if (all.length < 1) return toast('请先保存至少一个浆料方案', 'warn');
  running = true;
  const out = card.querySelector('.batch-out') as HTMLElement;
  out.replaceChildren(h('div', { class: 'muted' }, `批量运行 ${all.length} 个浆料方案…`));
  batchRows = [];
  const engine = getEngine();
  try {
    for (const f of all) {
      out.textContent = `正在跑：${f.name} …`;
      const s = await runSimulation({ mold, furnish: f, params, engine });
      batchRows.push({
        furnish: f.name,
        fi: s.record.stats.formationIndex,
        clarity: s.record.stats.clarity,
        defects: s.record.stats.defectCounts.pinhole + s.record.stats.defectCounts.thin + s.record.stats.defectCounts.floc + s.record.stats.defectCounts.distortion,
        cv: s.record.stats.cvPercent,
        elapsed: s.record.stats.elapsedMs / 1000,
      });
      await dbPut('sims', s.record);
    }
    out.replaceChildren(h('div', { class: 'ok-box' }, `批量完成，共 ${batchRows.length} 个方案，请到「批量对比」Tab 查看。`));
    toast('批量仿真完成');
  } finally {
    running = false;
  }
}

function renderBatchTable(host: HTMLElement): void {
  if (!host || batchRows.length === 0) return;
  host.replaceChildren(
    h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, '浆料方案'), h('th', {}, '匀度 FI↑'), h('th', {}, '水印清晰度%↑'), h('th', {}, '纸病总数↓'), h('th', {}, 'CV%↓'), h('th', {}, '用时 s'))),
      h('tbody', {}, ...batchRows.map((r) =>
        h('tr', {}, h('td', {}, r.furnish), h('td', {}, fmt(r.fi, 1)), h('td', {}, fmt(r.clarity, 1)), h('td', {}, String(r.defects)), h('td', {}, fmt(r.cv, 2)), h('td', {}, fmt(r.elapsed, 1))),
      )),
    ),
  );
}

async function doReproCheck(card: HTMLElement): Promise<void> {
  if (running) return;
  running = true;
  const out = card.querySelector('.batch-out') as HTMLElement;
  try {
    const engine = getEngine();
    const mold = getState().currentMold!;
    const furnish = getState().currentFurnish!;
    out.replaceChildren(h('div', { class: 'muted' }, '第一次运行…'));
    const a = await runSimulation({ mold, furnish, params, engine });
    out.replaceChildren(h('div', { class: 'muted' }, '同参数第二次运行…'));
    const b = await runSimulation({ mold, furnish, params, engine });
    const same = a.record.fingerprint === b.record.fingerprint;
    out.replaceChildren(
      h('div', { class: same ? 'ok-box' : 'danger-box' },
        same
          ? `复现性通过：两次指纹完全一致（${a.record.fingerprint}）`
          : `复现失败：指纹不一致 ${a.record.fingerprint} ≠ ${b.record.fingerprint}`),
    );
  } finally {
    running = false;
  }
}

async function doSeedSweep(card: HTMLElement): Promise<void> {
  if (running) return;
  running = true;
  const out = card.querySelector('.batch-out') as HTMLElement;
  const engine = getEngine();
  const mold = getState().currentMold!;
  const furnish = getState().currentFurnish!;
  const target = furnish.targetBasisWeight;
  const means: number[] = [];
  try {
    for (let i = 0; i < 5; i++) {
      out.replaceChildren(h('div', { class: 'muted' }, `换种子运行 ${i + 1}/5 …`));
      const p: SimParams = { ...params, seed: (params.seed + i * 104729) >>> 0 };
      const s = await runSimulation({ mold, furnish, params: p, engine });
      means.push(s.record.stats.meanBasisWeight);
    }
    const devs = means.map((m) => Math.abs(m - target) / target);
    const maxDev = Math.max(...devs);
    out.replaceChildren(
      h('div', { class: maxDev <= 0.01 ? 'ok-box' : 'danger-box' },
        `5 个种子平均定量偏差最大 ${pct(maxDev, 3)}（要求 ≤1.000%），均值范围 ${fmt(Math.min(...means), 2)} ~ ${fmt(Math.max(...means), 2)} g/m²。`,
        h('div', { class: 'muted', style: 'margin-top:4px' }, means.map((m, i) => `种子${i + 1}: ${fmt(m, 3)}`).join(' · ')),
      ),
    );
  } finally {
    running = false;
  }
}

function stat(k: string, v: string, unit = '', cls = ''): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: `v ${cls}` }, v, unit ? h('small', { style: 'font-size:11px;color:var(--text-dim)' }, ` ${unit}`) : undefined));
}

function infoRow(k: string, v: string, mono = false): HTMLElement {
  return h('tr', {}, h('th', {}, k), h('td', { class: mono ? 'mono' : '' }, v));
}
