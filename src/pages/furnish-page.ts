// 浆料配方页

import { dbDelete, dbPut, listFurnishes } from '../lib/db';
import { generateLengthHistogram, normalizeRatios, ratioValid } from '../lib/furnish';
import { button, clear, drawHistogram, fmt, h, labeledField, numInput, slider, toast } from '../lib/page-utils';
import { getState, setFurnish } from '../lib/session';
import type { FurnishDoc } from '../lib/types';
import { defaultFurnish } from '../lib/furnish';

let draft: FurnishDoc;
let saved: FurnishDoc[] = [];

export async function renderFurnishPage(root: HTMLElement): Promise<void> {
  clear(root);
  saved = await listFurnishes();
  draft = getState().currentFurnish ? { ...getState().currentFurnish! } : defaultFurnish();

  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, '浆料配方'), h('p', {}, '针叶/阔叶/棉浆配比，纤维长度、粗度与打浆度分开设；长度分布按对数正态混合模型程序生成。')),
  );
  const left = h('div', {});
  const right = h('div', {});
  root.append(h('div', { class: 'layout-2 narrow-left' }, left, right));
  renderLeft(left);
  renderRight(right);
}

function renderLeft(left: HTMLElement): void {
  clear(left);

  const ratioCard = h('div', { class: 'card' }, h('h2', {}, '浆种配比'));
  const ratioLine = h('div', { class: 'muted' }, '');
  const refreshRatio = () => {
    ratioLine.textContent = `当前合计 ${fmt((draft.softwood + draft.hardwood + draft.cotton) * 100, 1)}%（保存时自动归一化）`;
    ratioLine.style.color = ratioValid(draft) ? 'var(--accent-2)' : 'var(--warn)';
  };
  ratioCard.append(
    ratioSlider('针叶木浆', draft.softwood, (v) => {
      draft.softwood = v;
      refreshRatio();
    }),
    ratioSlider('阔叶木浆', draft.hardwood, (v) => {
      draft.hardwood = v;
      refreshRatio();
    }),
    ratioSlider('棉浆', draft.cotton, (v) => {
      draft.cotton = v;
      refreshRatio();
    }),
    ratioLine,
  );
  refreshRatio();
  left.append(ratioCard);

  const fiberCard = h('div', { class: 'card' }, h('h2', {}, '纤维参数（分浆种）'));
  fiberCard.append(
    h('h3', {}, '针叶木浆'),
    labeledField('平均长度 mm', numInput(draft.swLengthMm, 0.1, 0.5, 5, (v) => { draft.swLengthMm = v; renderRightLazy(); })),
    labeledField('粗度 mg/100m', numInput(draft.swCoarsenessMg, 0.5, 5, 40, (v) => { draft.swCoarsenessMg = v; renderRightLazy(); })),
    h('h3', {}, '阔叶木浆'),
    labeledField('平均长度 mm', numInput(draft.hwLengthMm, 0.05, 0.2, 3, (v) => { draft.hwLengthMm = v; renderRightLazy(); })),
    labeledField('粗度 mg/100m', numInput(draft.hwCoarsenessMg, 0.5, 3, 30, (v) => { draft.hwCoarsenessMg = v; renderRightLazy(); })),
    h('h3', {}, '棉浆'),
    labeledField('平均长度 mm', numInput(draft.cotLengthMm, 0.1, 0.4, 6, (v) => { draft.cotLengthMm = v; renderRightLazy(); })),
    labeledField('粗度 mg/100m', numInput(draft.cotCoarsenessMg, 0.5, 4, 35, (v) => { draft.cotCoarsenessMg = v; renderRightLazy(); })),
  );
  left.append(fiberCard);

  const processCard = h('div', { class: 'card' }, h('h2', {}, '打浆与抄造参数'));
  processCard.append(
    labeledField(`打浆度 °SR（${fmt(draft.beatingDegree, 0)}）`, slider(draft.beatingDegree, 15, 90, 1, (v) => {
      draft.beatingDegree = v;
      renderLeftLazy();
      renderRightLazy();
    })),
    labeledField('上网浓度 %', numInput(draft.headboxConsistency, 0.01, 0.05, 1.2, (v) => { draft.headboxConsistency = v; })),
    labeledField('流速 m/min', numInput(draft.flowSpeed, 5, 50, 800, (v) => { draft.flowSpeed = v; })),
    labeledField('目标定量 g/m²', numInput(draft.targetBasisWeight, 1, 40, 250, (v) => { draft.targetBasisWeight = v; })),
  );
  left.append(processCard);

  left.append(
    h('div', { class: 'card' }, h('h2', {}, '保存'),
      h('div', { class: 'btn-row' },
        button('保存配方', () => void save(), true),
        button('另存为新配方', () => void save(true)),
        button('恢复默认', () => {
          draft = defaultFurnish(draft.name);
          renderFurnishPage(document.querySelector('main')!);
        }),
      ),
      h('div', { style: 'margin-top:12px' }, ...saved.map((f) => furnishItem(f))),
    ),
  );
}

function ratioSlider(label: string, value: number, onInput: (v: number) => void): HTMLElement {
  return labeledField(`${label}（${fmt(value * 100, 1)}%）`, slider(value, 0, 1, 0.01, onInput));
}

function furnishItem(f: FurnishDoc): HTMLElement {
  const isCur = getState().currentFurnish?.id === f.id;
  return h('div', { class: `list-item ${isCur ? 'selected' : ''}` },
    h('div', {}, h('div', {}, f.name), h('div', { class: 'meta' }, `针${fmt(f.softwood * 100, 0)}/阔${fmt(f.hardwood * 100, 0)}/棉${fmt(f.cotton * 100, 0)} · ${fmt(f.targetBasisWeight, 0)}g/m² · ${fmt(f.beatingDegree, 0)}°SR`)),
    h('div', { class: 'btn-row', style: 'margin:0' },
      button('载入', () => {
        draft = { ...f };
        setFurnish(f);
        renderFurnishPage(document.querySelector('main')!);
      }),
      button('删', () => {
        void dbDelete('furnishes', f.id).then(() => {
          if (getState().currentFurnish?.id === f.id) setFurnish(null);
          renderFurnishPage(document.querySelector('main')!);
          toast('已删除');
        });
      }, true),
    ),
  );
}

async function save(asNew = false): Promise<void> {
  const normalized = normalizeRatios({ ...draft, updatedAt: Date.now() });
  if (asNew) normalized.id = `fur_${Date.now().toString(36)}`;
  await dbPut('furnishes', normalized);
  draft = normalized;
  setFurnish(normalized);
  toast('配方已保存');
  renderFurnishPage(document.querySelector('main')!);
}

function renderRight(right: HTMLElement): void {
  clear(right);
  const bins = generateLengthHistogram(draft, 42);
  const histCanvas = h('canvas', { style: 'width:100%;height:260px' }) as HTMLCanvasElement;
  requestAnimationFrame(() => drawHistogram(histCanvas, bins, [{ label: '纤维长度分布', color: 'var(--accent)' }]));

  const specs = [
    { name: '针叶', len: draft.swLengthMm, coarse: draft.swCoarsenessMg, ratio: draft.softwood },
    { name: '阔叶', len: draft.hwLengthMm, coarse: draft.hwCoarsenessMg, ratio: draft.hardwood },
    { name: '棉浆', len: draft.cotLengthMm, coarse: draft.cotCoarsenessMg, ratio: draft.cotton },
  ];

  right.append(
    h('div', { class: 'card' }, h('h2', {}, '程序生成纤维长度分布'),
      h('p', { class: 'muted' }, '对数正态混合模型，打浆度提高会切断长纤维使分布左移；直方图种子固定，参数不变则分布不变。'),
      histCanvas,
      h('table', { class: 'data', style: 'margin-top:12px' },
        h('thead', {}, h('tr', {}, h('th', {}, '浆种'), h('th', {}, '配比'), h('th', {}, '中位长 mm'), h('th', {}, '粗度 mg/100m'))),
        h('tbody', {}, ...specs.map((s) => h('tr', {}, h('td', {}, s.name), h('td', {}, `${fmt(s.ratio * 100, 1)}%`), h('td', {}, fmt(s.len, 2)), h('td', {}, fmt(s.coarse, 1))))),
      ),
    ),
    h('div', { class: 'card' }, h('h2', {}, '工艺提示'),
      h('ul', { style: 'margin:0;padding-left:18px;color:var(--text-dim);font-size:12.5px;line-height:1.9' },
        h('li', {}, `上网浓度 ${fmt(draft.headboxConsistency, 2)}%：${draft.headboxConsistency > 0.5 ? '偏高，絮聚风险大，匀度下降' : '处于防伪纸常用区间 0.2~0.5%'}`),
        h('li', {}, `打浆度 ${fmt(draft.beatingDegree, 0)}°SR：${draft.beatingDegree > 60 ? '偏高，干燥收缩与针眼风险增大' : '利于纤维结合与水印清晰度'}`),
        h('li', {}, `棉浆 ${fmt(draft.cotton * 100, 0)}%：提高耐折度，但收缩率随棉浆比例上升`),
      ),
    ),
  );
}

function renderRightLazy(): void {
  const right = document.querySelector<HTMLElement>('main .layout-2 > div:last-child');
  if (right) renderRight(right);
}
function renderLeftLazy(): void {
  const left = document.querySelector<HTMLElement>('main .layout-2 > div:first-child');
  if (left) renderLeft(left);
}
