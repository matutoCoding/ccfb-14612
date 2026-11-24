// ===== 页面 6：打样记录 =====
import { h, clearEl, toast, fmtTime, readFileAsDataUrl, modal } from '../ui/dom';
import { deleteProof, listMolds, listProofs, listRecipes, listSims, newId, saveProof } from '../db';
import { getState } from '../state';
import type { ProofRecord } from '../types';

export async function renderProofPage(root: HTMLElement): Promise<void> {
  root.append(h('h2', { class: 'page-title' }, '打样记录'), h('p', { class: 'page-sub' }, '每条打样绑定网模版本与浆料批次，实拍透光照片与仿真透光图并排比对，积累实物↔仿真偏差档案。'));

  const [proofs, molds, recipes, sims] = await Promise.all([listProofs(), listMolds(), listRecipes(), listSims()]);
  const state = getState();

  const head = h('div', { class: 'panel' });
  root.append(head);
  head.append(h('h3', {}, '新建打样记录'));
  if (!molds.length || !recipes.length) {
    head.append(h('div', { class: 'empty' }, '需要先保存网模方案与浆料配方。'));
  } else {
    const row = h('div', { class: 'row3' });
    const nameIn = h<HTMLInputElement>('input', { type: 'text', value: `打样 ${proofs.length + 1}` });
    const moldSel = h<HTMLSelectElement>('select', {}, ...molds.map((m) => h('option', { value: m.id }, `${m.name} v${m.version}`)));
    const recipeSel = h<HTMLSelectElement>('select', {}, ...recipes.map((r) => h('option', { value: r.id }, r.name)));
    const batchIn = h<HTMLInputElement>('input', { type: 'text', value: `B${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-1` });
    // 同网模/浆料/种子只保留最新一条，避免下拉重复
    const simKey = (s: (typeof sims)[number]) => `${s.params.moldId}|${s.params.recipeId}|${s.params.seed}`;
    const seen = new Set<string>();
    const uniqueSims = sims.filter((s) => {
      const k = simKey(s);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const simSel = h<HTMLSelectElement>('select', {}, h('option', { value: '' }, '不关联仿真'), ...uniqueSims.map((s) => h('option', { value: s.id, selected: state.lastSimId === s.id ? 'true' : null }, `${s.moldName}/${s.recipeName}/种子${s.params.seed}`)));
    row.append(
      h('label', { class: 'field' }, h('span', {}, '记录名称'), nameIn),
      h('label', { class: 'field' }, h('span', {}, '网模版本'), moldSel),
      h('label', { class: 'field' }, h('span', {}, '浆料方案'), recipeSel),
    );
    const row2 = h('div', { class: 'row2' });
    row2.append(
      h('label', { class: 'field' }, h('span', {}, '浆料批次号'), batchIn),
      h('label', { class: 'field' }, h('span', {}, '关联仿真'), simSel),
    );
    const noteIn = h<HTMLTextAreaElement>('textarea', { rows: '2', placeholder: '工艺备注：车速、真空度、干燥温度…' });
    const fileIn = h<HTMLInputElement>('input', { type: 'file', accept: 'image/*' });
    let photoDataUrl = '';
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files?.[0];
      if (f) {
        photoDataUrl = await readFileAsDataUrl(f);
        toast('实拍照片已载入', 'ok');
      }
    });
    const btnSave = h('button', { class: 'primary' }, '保存打样记录');
    btnSave.addEventListener('click', async () => {
      const mold = molds.find((m) => m.id === moldSel.value)!;
      const simId = simSel.value || undefined;
      const simThumb = simId ? sessionStorage.getItem(`simthumb:${simId}`) ?? '' : '';
      const rec: ProofRecord = {
        id: newId('proof'),
        name: nameIn.value || '未命名打样',
        createdAt: Date.now(),
        moldId: mold.id,
        moldVersion: mold.version,
        recipeId: recipeSel.value,
        recipeBatch: batchIn.value,
        simId,
        photoDataUrl: photoDataUrl || undefined,
        simDataUrl: simThumb || undefined,
        note: noteIn.value || undefined,
      };
      await saveProof(rec);
      toast('打样记录已保存', 'ok');
      clearEl(root);
      renderProofPage(root);
    });
    head.append(row, row2, h('label', { class: 'field' }, h('span', {}, '实拍透光照片（对光拍摄）'), fileIn), h('label', { class: 'field' }, h('span', {}, '备注'), noteIn), h('div', { class: 'btn-row' }, btnSave));
  }

  // 列表卡片
  const listPanel = h('div', { class: 'panel' });
  root.append(listPanel);
  listPanel.append(h('h3', {}, `打样档案（${proofs.length}）`));
  if (!proofs.length) {
    listPanel.append(h('div', { class: 'empty' }, '暂无打样记录'));
    return;
  }
  const cards = h('div', { class: 'grid grid-2b' });
  for (const p of proofs) {
    const mold = molds.find((m) => m.id === p.moldId);
    const recipe = recipes.find((r) => r.id === p.recipeId);
    const card = h('div', { class: 'panel', style: { margin: '0' } });
    card.append(
      h('div', { class: 'inline', style: { justifyContent: 'space-between' } }, h('b', {}, p.name), h('span', { class: 'small' }, fmtTime(p.createdAt))),
      h('div', { class: 'small', style: { margin: '6px 0' } }, `网模：${mold?.name ?? '—'} v${p.moldVersion} · 浆料：${recipe?.name ?? '—'} · 批次 ${p.recipeBatch}`),
    );
    const pair = h('div', { class: 'comparison' });
    pair.append(
      h('figure', {}, p.simDataUrl ? h('img', { class: 'img-pair', src: p.simDataUrl }) : h('div', { class: 'empty' }, '无仿真图'), h('figcaption', {}, '仿真透光图')),
      h('figure', {}, p.photoDataUrl ? h('img', { class: 'img-pair', src: p.photoDataUrl }) : h('div', { class: 'empty' }, '未导入实拍照片'), h('figcaption', {}, '实拍透光照片')),
    );
    card.append(pair);
    if (p.note) card.append(h('div', { class: 'dim', style: { marginTop: '8px' } }, '备注：' + p.note));
    const btnRow = h('div', { class: 'btn-row' });
    const btnView = h('button', { class: 'sm' }, '放大对比');
    btnView.addEventListener('click', () => openCompare(p));
    const btnDel = h('button', { class: 'sm danger' }, '删除');
    btnDel.addEventListener('click', async () => {
      await deleteProof(p.id);
      toast('已删除', 'ok');
      clearEl(root);
      renderProofPage(root);
    });
    btnRow.append(btnView, btnDel);
    card.append(btnRow);
    cards.append(card);
  }
  listPanel.append(cards);
}

function openCompare(p: ProofRecord): void {
  const body = h('div', { class: 'comparison' });
  body.append(
    h('figure', {}, p.simDataUrl ? h('img', { class: 'img-pair', src: p.simDataUrl }) : h('div', { class: 'empty' }, '无仿真图'), h('figcaption', {}, '仿真')),
    h('figure', {}, p.photoDataUrl ? h('img', { class: 'img-pair', src: p.photoDataUrl }) : h('div', { class: 'empty' }, '无实拍'), h('figcaption', {}, '实拍')),
  );
  const close = modal(`打样对比：${p.name}`, body, h('button', { class: 'primary' }, '关闭'));
  const btn = body.parentElement?.querySelector('button.primary');
  btn?.addEventListener('click', close);
}
