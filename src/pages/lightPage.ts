// ===== 页面 4：透光观察（透射 / 反射）=====
import { h, clearEl, toast, rangeField, canvasThumb, triggerDownload } from '../ui/dom';
import { getState, setState } from '../state';
import { loadSim } from '../db';
import { listSims } from '../db';
import { GpuDepositEngine } from '../sim/gpuEngine';

export async function renderLightPage(root: HTMLElement): Promise<void> {
  root.append(h('h2', { class: 'page-title' }, '透光观察'), h('p', { class: 'page-sub' }, '透射光按纤维层厚度做 Beer-Lambert 衰减，水印层次分明；反射光以漫反射为主，水印几乎不可见。可切换光源角度与纸张翻面。'));

  const state = getState();
  if (!state.sims.length) state.sims = await listSims();
  if (!state.sims.length) {
    root.append(h('div', { class: 'panel empty' }, '暂无仿真结果，请先到「抄造仿真」运行一次。'));
    return;
  }

  let simId = state.lastSimId && state.sims.some((s) => s.id === state.lastSimId) ? state.lastSimId! : state.sims[0].id;
  let sim = (await loadSim(simId))!;
  let mode: 0 | 1 | 2 = 1;
  let lightAngle = Math.PI / 4;
  let flip = false;
  let engine: GpuDepositEngine | null = null;
  let fieldTex: WebGLTexture | null = null;

  const grid = h('div', { class: 'grid grid-2' });
  root.append(grid);
  const ctrl = h('div', { class: 'panel' });
  const view = h('div', { class: 'panel' });
  grid.append(ctrl, view);

  const canvas = h<HTMLCanvasElement>('canvas', { style: { width: '100%', maxHeight: '520px', background: '#05080c', borderRadius: '8px' } });

  function ensureEngine(): void {
    if (engine) return;
    engine = new GpuDepositEngine(canvas);
  }
  function upload(): void {
    if (!sim.thicknessField || !sim.gridW || !sim.gridH) {
      toast('该结果场数据未缓存（历史记录只存统计），请重新运行仿真', 'err', 4000);
      return;
    }
    ensureEngine();
    fieldTex = engine!.uploadField(sim.thicknessField, sim.gridW, sim.gridH);
    resizeCanvas();
    draw();
  }
  function resizeCanvas(): void {
    if (!sim.gridW || !sim.gridH) return;
    const maxW = view.clientWidth - 40;
    const scale = Math.min(1, maxW / sim.gridW, 560 / sim.gridH);
    canvas.width = Math.round(sim.gridW * scale);
    canvas.height = Math.round(sim.gridH * scale);
  }
  function draw(): void {
    if (!engine || !fieldTex || !sim.gridW) return;
    engine.renderField(fieldTex, sim.gridW, sim.gridH!, mode, sim.meanBasisWeight, lightAngle, flip);
  }

  function renderCtrl(): void {
    clearEl(ctrl);
    ctrl.append(h('h3', {}, '观察控制'));
    const sel = h<HTMLSelectElement>('select', {}, ...state.sims.map((s) => h('option', { value: s.id, selected: s.id === simId ? 'true' : null }, `${s.moldName} / ${s.recipeName} / 种子${s.params.seed}`)));
    sel.addEventListener('change', async () => {
      simId = sel.value;
      sim = (await loadSim(simId))!;
      setState({ lastSimId: simId, lastSimResult: sim });
      fieldTex = null;
      upload();
      renderInfo();
    });
    ctrl.append(h('label', { class: 'field' }, h('span', {}, '选择仿真结果'), sel));

    const tabs = h('div', { class: 'tabs' });
    const tabDefs: [0 | 1 | 2, string][] = [
      [1, '透射光（背光）'],
      [2, '反射光（正面）'],
      [0, '定量伪彩'],
    ];
    for (const [m, label] of tabDefs) {
      const t = h('div', { class: 'tab' + (mode === m ? ' active' : '') }, label);
      t.addEventListener('click', () => {
        mode = m;
        renderCtrl();
        updateTitle();
        draw();
      });
      tabs.append(t);
    }
    ctrl.append(tabs);

    ctrl.append(
      rangeField('光源入射角', lightAngle, 0, Math.PI / 2, 0.05, ' rad', (v) => {
        lightAngle = v;
        draw();
      }).wrap,
    );
    const flipLine = h('label', { class: 'checkline' }, h('input', { type: 'checkbox', checked: flip ? 'true' : null }), '纸张翻面观察（镜像）');
    flipLine.addEventListener('change', () => {
      flip = !flip;
      draw();
    });
    ctrl.append(flipLine);

    ctrl.append(h('hr', { class: 'sep' }));
    const btnShot = h('button', { class: 'primary' }, '导出当前观察图 PNG');
    btnShot.addEventListener('click', () => {
      const url = canvas.toDataURL('image/png');
      triggerDownload(url, `watermark_${mode === 1 ? 'trans' : mode === 2 ? 'reflect' : 'heat'}_${simId}.png`);
    });
    const btnThumb = h('button', { class: 'ghost' }, '生成缩略图供打样对比');
    btnThumb.addEventListener('click', () => {
      const url = canvasThumb(canvas, 640);
      setState({ lastSimResult: { ...sim }, lastSimId: simId });
      sessionStorage.setItem(`simthumb:${simId}`, url);
      toast('仿真缩略图已暂存，可到打样记录并排比对', 'ok');
    });
    ctrl.append(h('div', { class: 'btn-row' }, btnShot, btnThumb));

    ctrl.append(h('hr', { class: 'sep' }));
    ctrl.append(
      h('div', { class: 'small' },
        h('div', { style: { marginBottom: '6px' } }, '物理模型说明：'),
        h('div', {}, '· 透射：T = exp(−μ·定量)，厚度差即明暗差，凸纹薄→亮白水印，凹纹厚→暗黑水印'),
        h('div', {}, '· 反射：纸面漫反射占主导，厚度差异被掩盖，仅浮雕斜面随光源角度出现微弱高光'),
        h('div', {}, '· 翻面：网面/毯面纹理镜像，水印深浅观感互换'),
      ),
    );
  }

  const info = h('div', { class: 'panel' });
  function renderInfo(): void {
    clearEl(info);
    info.append(h('h3', {}, '当前纸面参数'));
    const g = h('div', { class: 'stat-grid' });
    g.append(
      kv('平均定量', sim.meanBasisWeight.toFixed(1), 'g/m²'),
      kv('定量 CV', sim.cvBasisWeight.toFixed(2), '%'),
      kv('水印清晰度', String(sim.clarity), '分'),
      kv('匀度指数', String(sim.formationIndex), '分'),
      kv('幅面', `${sim.widthMm}×${sim.heightMm}`, 'mm'),
    );
    info.append(g);
  }

  const viewTitle = h('h3', {}, mode === 1 ? '透射光观察（对光看水印）' : mode === 2 ? '反射光观察（正常纸面）' : '定量分布伪彩');
  view.append(viewTitle, h('div', { class: 'canvas-box' }, canvas), info);
  const updateTitle = (): void => {
    viewTitle.textContent = mode === 1 ? '透射光观察（对光看水印）' : mode === 2 ? '反射光观察（正常纸面）' : '定量分布伪彩';
  };
  renderCtrl();
  renderInfo();
  upload();
}

function kv(k: string, v: string, u: string): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, h('span', { class: 'u' }, u)));
}
