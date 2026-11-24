// ===== 页面 1：网模设计 =====
import { h, clearEl, toast, fmtTime, readFileAsDataUrl, loadImage, canvasThumb, rangeField } from '../ui/dom';
import { deleteMold, listMolds, loadMold, saveMold } from '../db';
import { getState, setState } from '../state';
import type { MoldDesign, ReliefLevel } from '../types';
import {
  builtinGrayPattern,
  detectPinholeRisk,
  grayToRelief,
  gridSizeFor,
  imageToGray,
  makeMoldDraft,
  renderGrayCanvas,
  renderReliefCanvas,
} from '../sim/mold';

export async function renderMoldPage(root: HTMLElement): Promise<void> {
  root.append(h('h2', { class: 'page-title' }, '网模设计'), h('p', { class: 'page-sub' }, '灰度图转网模浮雕：凸起出白水印、凹下出黑水印；浮雕高度可分档手改，陡边自动提示针眼风险。'));

  const state = getState();
  state.molds = await listMolds();

  let current: MoldDesign | null = state.molds[0] ? await loadMold(state.molds[0].id) : null;
  if (!current) current = makeMoldDraft('新建网模方案');
  let gray: Float32Array | null = current.relief ? null : null;
  let risk: ReturnType<typeof detectPinholeRisk> | null = null;

  const grid = h('div', { class: 'grid grid-2' });
  root.append(grid);

  // ---------- 左：方案列表 + 新建 ----------
  const left = h('div', { class: 'panel' });
  const center = h('div', { class: 'panel' });
  const right = h('div', { class: 'panel' });
  grid.append(left, h('div', {}, center, right));

  function renderList(): void {
    clearEl(left);
    left.append(h('h3', {}, '网模方案库', h('span', { class: 'tag' }, `共 ${state.molds.length} 个`)));
    const btnNew = h('button', { class: 'primary sm', style: { width: '100%', marginBottom: '10px' } }, '＋ 新建网模方案');
    btnNew.addEventListener('click', () => {
      current = makeMoldDraft(`网模方案 ${state.molds.length + 1}`);
      gray = null;
      risk = null;
      renderEditor();
      renderPreview();
      toast('已创建草稿，设置参数后点"生成浮雕"', 'ok');
    });
    left.append(btnNew);
    const list = h('div', { class: 'side-list' });
    if (!state.molds.length) list.append(h('div', { class: 'empty' }, '暂无保存的方案'));
    for (const m of state.molds) {
      const item = h('div', { class: 'list-item' + (current?.id === m.id ? ' sel' : '') });
      item.append(
        h('div', { class: 't' }, `${m.name} ${m.version > 1 ? `v${m.version}` : ''}`),
        h('div', { class: 's' }, `${m.widthMm}×${m.heightMm}mm · ${fmtTime(m.updatedAt)}`),
        h('div', { class: 's' }, m.pinholeRiskCount ? h('span', { class: 'bad' }, `针眼风险点 ${m.pinholeRiskCount}`) : h('span', { class: 'good' }, '无陡边风险')),
      );
      item.addEventListener('click', async () => {
        current = await loadMold(m.id);
        gray = null;
        risk = null;
        renderList();
        renderEditor();
        renderPreview();
      });
      list.append(item);
    }
    left.append(list);
  }

  // ---------- 中：参数编辑 ----------
  function renderEditor(): void {
    clearEl(center);
    const m = current!;
    center.append(h('h3', {}, '设计参数'));

    const nameInput = h<HTMLInputElement>('input', { type: 'text', value: m.name });
    center.append(h('label', { class: 'field' }, h('span', {}, '方案名称'), nameInput));
    nameInput.addEventListener('input', () => (m.name = nameInput.value));

    const dims = h('div', { class: 'row2' });
    const wIn = h<HTMLInputElement>('input', { type: 'number', value: String(m.widthMm), min: '50', max: '500' });
    const hIn = h<HTMLInputElement>('input', { type: 'number', value: String(m.heightMm), min: '50', max: '500' });
    dims.append(
      h('label', { class: 'field' }, h('span', {}, '幅面宽 mm'), wIn),
      h('label', { class: 'field' }, h('span', {}, '幅面高 mm'), hIn),
    );
    wIn.addEventListener('input', () => (m.widthMm = Number(wIn.value)));
    hIn.addEventListener('input', () => (m.heightMm = Number(hIn.value)));
    center.append(dims);

    center.append(rangeField('浮雕栅格分辨率（像素/100mm）', m.gridRes, 60, 220, 10, '', (v) => (m.gridRes = v)).wrap);

    // 灰度来源
    const srcBox = h('div');
    center.append(h('hr', { class: 'sep' }), h('h3', {}, '灰度图来源'));
    const fileInput = h<HTMLInputElement>('input', { type: 'file', accept: 'image/*' });
    fileInput.style.marginBottom = '8px';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const url = await readFileAsDataUrl(file);
        const img = await loadImage(url);
        const { w, h } = gridSizeFor(m.widthMm, m.heightMm, m.gridRes);
        gray = imageToGray(img, w, h);
        m.sourceThumb = canvasThumb(renderGrayCanvas(gray, w, h), 240);
        toast('灰度图已载入', 'ok');
        renderPreview();
      } catch (e) {
        toast('图片读取失败: ' + String(e), 'err');
      }
    });
    const btnBuiltin = h('button', { class: 'sm' }, '使用内置测试徽章图案');
    btnBuiltin.addEventListener('click', () => {
      const { w, h } = gridSizeFor(m.widthMm, m.heightMm, m.gridRes);
      gray = builtinGrayPattern(w, h, 20261125);
      m.sourceThumb = canvasThumb(renderGrayCanvas(gray, w, h), 240);
      toast('已生成内置图案', 'ok');
      renderPreview();
    });
    srcBox.append(fileInput, h('div', { class: 'small', style: { margin: '6px 0' } }, '支持 PNG/JPG，白=高浮雕（白水印），黑=凹下（黑水印）'), btnBuiltin);
    center.append(srcBox);

    // 分档表
    center.append(h('hr', { class: 'sep' }), h('h3', {}, '浮雕高度分档（可手改，μm）'));
    const tableWrap = h('div', { class: 'table-wrap' });
    const table = h('table');
    table.append(h('thead', {}, h('tr', {}, h('th', {}, '档位'), h('th', {}, '灰度区间'), h('th', {}, '高度 μm'), h('th', {}, '类型'))));
    const tb = h('tbody');
    for (const lv of m.levels) {
      const tr = h('tr');
      const hIn2 = h<HTMLInputElement>('input', { type: 'number', value: String(lv.heightUm), step: '1', style: { width: '82px' } });
      hIn2.addEventListener('input', () => {
        lv.heightUm = Number(hIn2.value);
      });
      tr.append(
        h('td', {}, lv.label),
        h('td', { class: 'num' }, `${lv.grayMin.toFixed(1)}–${lv.grayMax.toFixed(1)}`),
        h('td', {}, hIn2),
        h('td', {}, typePill(lv.heightUm)),
      );
      tb.append(tr);
    }
    table.append(tb);
    tableWrap.append(table);
    center.append(tableWrap);
    center.append(h('div', { class: 'small', style: { marginTop: '6px' } }, '正值=凸起（白水印，脱水快、纸薄透光亮）；负值=凹下（黑水印，纤维堆积偏厚、透光暗）；0=纸面基准。'));

    const btnGen = h('button', { class: 'primary' }, '生成浮雕并检测针眼风险');
    btnGen.addEventListener('click', () => {
      const { w, h } = gridSizeFor(m.widthMm, m.heightMm, m.gridRes);
      if (!gray) gray = builtinGrayPattern(w, h, 20261125);
      const relief = grayToRelief(gray, m.levels);
      m.relief = relief;
      m.gridW = w;
      m.gridH = h;
      risk = detectPinholeRisk(relief, w, h);
      m.pinholeRiskCount = risk.count;
      m.pinholeRiskFraction = risk.fraction;
      m.updatedAt = Date.now();
      renderPreview();
      toast(`浮雕生成完成：${w}×${h} 栅格，针眼风险点 ${risk.count} 个`, risk.count ? 'info' : 'ok');
    });
    const btnSave = h('button', {}, '保存方案到 IndexedDB');
    btnSave.addEventListener('click', async () => {
      if (!m.relief) {
        toast('请先生成浮雕', 'err');
        return;
      }
      m.updatedAt = Date.now();
      await saveMold(m);
      state.molds = await listMolds();
      setState({ molds: state.molds, selectedMoldId: m.id });
      toast(`方案「${m.name}」已保存`, 'ok');
      renderList();
    });
    const btnCopy = h('button', { class: 'ghost' }, '另存为新版本');
    btnCopy.addEventListener('click', async () => {
      if (!m.relief) return toast('请先生成浮雕', 'err');
      const copy: MoldDesign = JSON.parse(JSON.stringify({ ...m, id: `mold_${Date.now().toString(36)}`, name: m.name + ' 副本' }));
      copy.relief = m.relief.slice();
      copy.version = m.version + 1;
      copy.createdAt = Date.now();
      copy.updatedAt = Date.now();
      await saveMold(copy);
      state.molds = await listMolds();
      current = copy;
      toast('新版本已保存', 'ok');
      renderList();
      renderEditor();
    });
    const btnDel = h('button', { class: 'danger' }, '删除');
    btnDel.addEventListener('click', async () => {
      if (!state.molds.some((x) => x.id === m.id)) return toast('草稿无需删除', 'info');
      await deleteMold(m.id);
      state.molds = await listMolds();
      current = state.molds[0] ? await loadMold(state.molds[0].id) : makeMoldDraft('新建网模方案');
      toast('已删除', 'ok');
      renderList();
      renderEditor();
      renderPreview();
    });
    center.append(h('div', { class: 'btn-row' }, btnGen, btnSave, btnCopy, btnDel));
  }

  // ---------- 右：预览 ----------
  function renderPreview(): void {
    clearEl(right);
    const m = current!;
    right.append(h('h3', {}, '浮雕预览'));
    const box = h('div', { class: 'canvas-box', style: { minHeight: '260px' } });
    right.append(box);
    if (m.relief && m.gridW && m.gridH) {
      const c = renderReliefCanvas(m.relief, m.gridW, m.gridH, risk ?? undefined);
      c.style.width = '100%';
      box.append(c);
      right.append(
        h('div', { class: 'legend' },
          h('span', {}, h('i', { style: { background: '#5a82c8' } }, ''), '凹下（黑水印）'),
          h('span', {}, h('i', { style: { background: '#d7dde6' } }, ''), '基准面'),
          h('span', {}, h('i', { style: { background: '#ffd9d6' } }, ''), '凸起（白水印）'),
          h('span', {}, h('i', { style: { background: '#f0645e' } }, ''), '针眼风险'),
        ),
      );
      const r = risk ?? detectPinholeRisk(m.relief, m.gridW, m.gridH);
      risk = r;
      const stat = h('div', { class: 'stat-grid', style: { marginTop: '12px' } });
      const heights = m.levels.map((l) => l.heightUm);
      stat.append(
        statBox('栅格尺寸', `${m.gridW}×${m.gridH}`, 'px'),
        statBox('浮雕范围', `${Math.min(...heights)}~${Math.max(...heights)}`, 'μm'),
        statBox('针眼风险点', String(r.count), '个', r.count ? 'bad' : 'good'),
        statBox('风险占比', (r.fraction * 100).toFixed(2), '%', r.fraction > 0.02 ? 'bad' : 'good'),
      );
      right.append(stat);
      if (r.count) {
        right.append(h('div', { class: 'pill warn', style: { marginTop: '10px' } }, `提示：${r.fraction > 0.02 ? '陡边偏多，抄造易诱发针眼，建议加大过渡圆角或降低相邻档高差' : '局部边缘较陡，注意浆料保气性，可适当提高打浆度'}`));
      }
    } else {
      box.append(h('div', { class: 'empty' }, '设置参数后点击「生成浮雕」'));
    }
  }

  renderList();
  renderEditor();
  renderPreview();
}

function typePill(height: number): HTMLElement {
  if (height > 0) return h('span', { class: 'pill info' }, '凸·白水印');
  if (height < 0) return h('span', { class: 'pill' }, '凹·黑水印');
  return h('span', { class: 'pill good' }, '基准');
}
function statBox(k: string, v: string, u: string, cls = ''): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' + (cls ? ' ' + cls : '') }, v, h('span', { class: 'u' }, u)));
}
