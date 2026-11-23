// 打样记录页：绑定网模版本与浆料批次，导入实测透光照片与仿真图并排对比

import { dbDelete, dbPut, listProofs, listSims } from '../lib/db';
import { button, clear, fmt, h, labeledField, numInput, toast, uploadBtn } from '../lib/page-utils';
import { getState } from '../lib/session';
import { nowTs, uid, type ProofRecord } from '../lib/types';

let draftPhoto = '';

export async function renderProofPage(root: HTMLElement): Promise<void> {
  clear(root);
  const proofs = await listProofs();
  const sims = await listSims();
  const session = getState().lastSimulation;

  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, '打样记录'), h('p', {}, '每条打样绑定网模版本与浆料批次，导入实际抄造的透光照片，与仿真透光图并排比对。')),
  );

  const left = h('div', {});
  const right = h('div', {});
  root.append(h('div', { class: 'layout-2 narrow-left' }, left, right));

  // 录入表单
  const nameInput = h('input', { type: 'text', value: `打样 ${new Date().toLocaleDateString('zh-CN')}` }) as HTMLInputElement;
  const batchInput = h('input', { type: 'text', value: `BATCH-${Date.now().toString(36).toUpperCase()}` }) as HTMLInputElement;
  const noteInput = h('textarea', { rows: 3, placeholder: '工艺备注 / 机台 / 操作员' }) as HTMLTextAreaElement;
  let clarityScore = 4;
  let defectObs = 0;

  const simOptions = [
    { value: '', label: '不绑定仿真' },
    ...sims.map((s) => ({ value: s.id, label: s.name })),
  ];
  const simSelect = h('select', {}) as HTMLSelectElement;
  for (const o of simOptions) simSelect.append(h('option', { value: o.value, selected: o.value === (session ? session.record.id : '') }, o.label));

  const photoPreview = h('div', { class: 'canvas-frame small', style: 'min-height:140px' }, h('span', { class: 'muted' }, '尚未导入照片'));

  const mold = getState().currentMold;
  const furnish = getState().currentFurnish;

  left.append(
    h('div', { class: 'card' }, h('h2', {}, '新建打样记录'),
      labeledField('打样名称', nameInput),
      h('div', { class: 'muted', style: 'margin-bottom:8px' },
        `绑定网模：${mold ? `${mold.name} v${mold.version}` : '未选择'} ｜ 浆料：${furnish ? furnish.name : '未选择'}`),
      labeledField('浆料批次号', batchInput),
      labeledField('关联仿真', simSelect),
      labeledField('实测清晰度评分（1~5）', numInput(clarityScore, 1, 1, 5, (v) => (clarityScore = Math.round(v)))),
      labeledField('实测纸病数', numInput(defectObs, 1, 0, 999, (v) => (defectObs = Math.round(v)))),
      labeledField('备注', noteInput),
      h('h3', {}, '实测透光照片'),
      uploadBtn('导入照片', (file) => {
        const reader = new FileReader();
        reader.onload = () => {
          draftPhoto = String(reader.result);
          photoPreview.replaceChildren(h('img', { src: draftPhoto, style: 'max-width:100%;max-height:320px' }));
        };
        reader.readAsDataURL(file);
      }),
      h('div', { style: 'margin:8px 0' }, photoPreview),
      button('保存打样记录', () => {
        if (!mold || !furnish) return toast('请先选择网模与浆料', 'warn');
        if (!draftPhoto) return toast('请先导入实测照片', 'warn');
        const rec: ProofRecord = {
          id: uid('proof'),
          name: nameInput.value || '未命名打样',
          simId: simSelect.value || null,
          moldId: mold.id,
          moldVersion: mold.version,
          furnishId: furnish.id,
          furnishBatch: batchInput.value,
          createdAt: nowTs(),
          photoDataUrl: draftPhoto,
          note: noteInput.value,
          clarityScore,
          defectCountObserved: defectObs,
        };
        void dbPut('proofs', rec).then(() => {
          draftPhoto = '';
          toast('打样记录已保存');
          renderProofPage(document.querySelector('main')!);
        });
      }, true),
    ),
  );

  // 记录列表与对比
  const listCard = h('div', { class: 'card' }, h('h2', {}, `打样记录（${proofs.length}）`));
  if (proofs.length === 0) {
    listCard.append(h('p', { class: 'muted' }, '暂无打样记录'));
  } else {
    proofs.sort((a, b) => b.createdAt - a.createdAt);
    for (const p of proofs) {
      const sim = sims.find((s) => s.id === p.simId) ?? null;
      const item = h('div', { class: 'list-item', style: 'flex-direction:column;align-items:stretch' },
        h('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
          h('div', {},
            h('div', {}, p.name, ' ', h('span', { class: 'badge badge-kind' }, `网模 v${p.moldVersion}`), ' ', h('span', { class: 'meta mono' }, p.furnishBatch)),
            h('div', { class: 'meta' }, `${new Date(p.createdAt).toLocaleString('zh-CN')} · 评分 ${p.clarityScore}/5 · 实测纸病 ${p.defectCountObserved}${p.note ? ` · ${p.note}` : ''}`),
          ),
          h('div', { class: 'btn-row', style: 'margin:0' },
            button('删除', () => {
              void dbDelete('proofs', p.id).then(() => {
                toast('已删除');
                renderProofPage(document.querySelector('main')!);
              });
            }, true),
          ),
        ),
        h('div', { class: 'img-compare', style: 'margin-top:8px' },
          h('figure', {}, h('img', { src: p.photoDataUrl, alt: '实测' }), h('figcaption', {}, '实测透光照片')),
          sim
            ? h('figure', {}, h('img', { src: sim.thumbTrans, alt: '仿真' }),
                h('figcaption', {}, `仿真透光图（FI ${fmt(sim.stats.formationIndex, 1)} · 清晰度 ${fmt(sim.stats.clarity, 1)}% · 纸病 ${sim.stats.defectCounts.pinhole + sim.stats.defectCounts.thin + sim.stats.defectCounts.floc + sim.stats.defectCounts.distortion}）`))
            : h('figure', {}, h('div', { class: 'canvas-frame small muted' }, '未关联仿真'), h('figcaption', {}, '无仿真对照')),
        ),
      );
      listCard.append(item);
    }
  }
  right.append(listCard);
}
