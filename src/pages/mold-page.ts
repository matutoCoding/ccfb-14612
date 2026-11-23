// 网模设计页

import { analyzeSlopes, applyBands, buildMold, defaultBands, generateDemoPattern, toGray } from '../lib/mold';
import { dbDelete, dbPut, listMolds } from '../lib/db';
import { button, clear, fmt, h, labeledField, numInput, readImageFile, renderGrayFieldSafe, toast, uploadBtn } from '../lib/page-utils';
import { getState, setMold } from '../lib/session';
import type { MoldBand, MoldDoc } from '../lib/types';

let workingGray: Float32Array | null = null;
let workingW = 0;
let workingH = 0;
let workingName = '未命名网模';
let bands: MoldBand[] = defaultBands();
let savedMolds: MoldDoc[] = [];

export async function renderMoldPage(root: HTMLElement): Promise<void> {
  clear(root);
  savedMolds = await listMolds();
  const cur = getState().currentMold;
  if (cur && workingGray === null) {
    workingGray = cur.gray;
    workingW = cur.width;
    workingH = cur.height;
    workingName = cur.name;
    bands = cur.bands.map((b) => ({ ...b }));
  }
  if (workingGray === null) {
    const p = generateDemoPattern();
    workingGray = p.gray;
    workingW = p.width;
    workingH = p.height;
  }

  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, '网模设计'), h('p', {}, '灰度图转网模浮雕：凸起出白水印、凹下出黑水印；浮雕分档可手动调整，边缘过陡自动提示针眼风险。')),
  );

  const left = h('div', {});
  const right = h('div', {});
  root.append(h('div', { class: 'layout-2' }, left, right));

  renderControls(left);
  renderPreview(right);
}

function renderControls(left: HTMLElement): void {
  clear(left);

  const nameInput = h('input', { type: 'text', value: workingName }) as HTMLInputElement;
  nameInput.addEventListener('input', () => (workingName = nameInput.value));

  const sourceCard = h('div', { class: 'card' }, h('h2', {}, '1. 灰度原稿'), labeledField('网模名称', nameInput));
  sourceCard.append(
    h('div', { class: 'btn-row' },
      uploadBtn('上传灰度图', (file) => {
        readImageFile(file)
          .then((img) => {
            workingGray = toGray(img);
            workingW = img.width;
            workingH = img.height;
            renderMoldPage(left.parentElement!.parentElement!);
            toast('灰度图已载入');
          })
          .catch(() => toast('图片读取失败', 'error'));
      }),
      button('徽章图案', () => loadDemo('medallion')),
      button('文字图案', () => loadDemo('text')),
      button('网格图案', () => loadDemo('grid')),
    ),
    h('p', { class: 'muted', style: 'margin-bottom:0' }, `当前原稿：${workingW} × ${workingH} px，映射 A4 210×297mm`),
  );
  left.append(sourceCard);

  // 分档编辑
  const bandCard = h('div', { class: 'card' }, h('h2', {}, '2. 浮雕分档（灰度 → 高度 μm）'));
  const bandList = h('div', {});
  bandCard.append(bandList);
  bands.forEach((b, idx) => {
    const row = h('div', { class: 'band-row' });
    const gInput = numInput(b.gray, 1, 0, 255, (v) => {
      b.gray = Math.round(v);
      refreshPreview();
    });
    const hInput = numInput(b.heightUm, 1, -200, 200, (v) => {
      b.heightUm = v;
      refreshPreview();
    });
    row.append(
      labeledField(`灰度 ${idx + 1}`, gInput),
      labeledField('高度 μm', hInput),
      button('删', () => {
        if (bands.length <= 2) return toast('至少保留两个档位', 'warn');
        bands.splice(idx, 1);
        renderControls(left);
        refreshPreview();
      }, false),
    );
    bandList.append(row);
  });
  bandCard.append(
    h('div', { class: 'btn-row' },
      button('＋ 增加档位', () => {
        const last = bands[bands.length - 1];
        bands.push({ gray: Math.min(255, last.gray + 40), heightUm: last.heightUm });
        bands.sort((a, b) => a.gray - b.gray);
        renderControls(left);
        refreshPreview();
      }),
    ),
    h('p', { class: 'muted' }, '正值＝网模凸起（白水印），负值＝凹下（黑水印），0＝平面。档位间线性插值。'),
  );
  left.append(bandCard);

  // 保存
  const saveCard = h('div', { class: 'card' }, h('h2', {}, '3. 保存与版本'));
  const cur = getState().currentMold;
  saveCard.append(
    h('div', { class: 'btn-row' },
      button('保存为新网模', () => void saveMold(null), true),
      cur ? button(`基于当前 v${cur.version} 升版`, () => void saveMold(cur)) : undefined,
    ),
    h('div', { style: 'margin-top:12px' }, ...savedMolds.map((m) => moldListItem(m))),
  );
  left.append(saveCard);
}

function moldListItem(m: MoldDoc): HTMLElement {
  const isCur = getState().currentMold?.id === m.id;
  const item = h('div', { class: `list-item ${isCur ? 'selected' : ''}` },
    h('div', {}, h('div', {}, `${m.name} `, h('span', { class: 'meta' }, `v${m.version} · ${m.width}×${m.height}`)), h('div', { class: 'meta' }, `针眼风险点 ${m.pinholeRiskCount}`)),
    h('div', { class: 'btn-row', style: 'margin:0' },
      button('载入', () => {
        workingGray = m.gray;
        workingW = m.width;
        workingH = m.height;
        workingName = m.name;
        bands = m.bands.map((b) => ({ ...b }));
        setMold(m);
        renderMoldPage(document.querySelector('main')!);
      }),
      button('删', () => {
        void dbDelete('molds', m.id).then(() => {
          if (getState().currentMold?.id === m.id) setMold(null);
          toast('已删除');
          renderMoldPage(document.querySelector('main')!);
        });
      }, true),
    ),
  );
  return item;
}

async function saveMold(parent: MoldDoc | null): Promise<void> {
  if (!workingGray) return;
  const mold = buildMold(workingName || '未命名网模', workingGray, workingW, workingH, bands, '', parent);
  await dbPut('molds', mold);
  setMold(mold);
  toast(parent ? `已保存为 v${mold.version}` : '网模已保存');
  renderMoldPage(document.querySelector('main')!);
}

function loadDemo(variant: 'medallion' | 'text' | 'grid'): void {
  const p = generateDemoPattern(560, 792, variant);
  workingGray = p.gray;
  workingW = p.width;
  workingH = p.height;
  renderMoldPage(document.querySelector('main')!);
}

function refreshPreview(): void {
  const right = document.querySelector<HTMLElement>('main .layout-2 > div:last-child');
  if (right) renderPreview(right);
}

function renderPreview(right: HTMLElement): void {
  clear(right);
  if (!workingGray) return;
  const relief = applyBands(workingGray, bands);
  const slope = analyzeSlopes(relief, workingW, workingH);
  const riskCount = slope.riskPixels.length;
  let maxH = -Infinity;
  let minH = Infinity;
  for (const v of relief) {
    if (v > maxH) maxH = v;
    if (v < minH) minH = v;
  }

  const grayCanvas = h('canvas', {}) as HTMLCanvasElement;
  const reliefCanvas = h('canvas', {}) as HTMLCanvasElement;
  const slopeCanvas = h('canvas', {}) as HTMLCanvasElement;
  renderGrayFieldSafe(grayCanvas, workingGray, workingW, workingH, null);
  renderGrayFieldSafe(reliefCanvas, relief, workingW, workingH, null);
  renderGrayFieldSafe(slopeCanvas, slope.grad, workingW, workingH, (_v, norm) => {
    if (norm > 0.55) return [231, 111, 81];
    if (norm > 0.32) return [244, 162, 97];
    const g = Math.round(norm * 180);
    return [g, g, g + 20];
  });

  const riskRatio = riskCount / relief.length;
  const warn =
    riskCount === 0
      ? h('div', { class: 'ok-box' }, `边缘陡度检查通过：最大 ${fmt(slope.maxSlope, 0)} μm/mm，未超过 350 μm/mm 针眼阈值。`)
      : h('div', { class: riskRatio > 0.02 ? 'danger-box' : 'warn-box' },
          `检测到 ${riskCount} 个过陡立面（${fmt(riskRatio * 100, 2)}% 面积），最大 ${fmt(slope.maxSlope, 0)} μm/mm。`,
          h('div', { style: 'margin-top:4px' }, '这些位置纤维易架桥形成针眼，建议降低相邻档位高度差或加大过渡灰阶宽度。'),
        );

  right.append(
    h('div', { class: 'card' },
      h('h2', {}, '浮雕预览与针眼风险'),
      h('div', { class: 'split' },
        h('div', {}, h('h3', {}, '灰度原稿'), h('div', { class: 'canvas-frame small' }, grayCanvas)),
        h('div', {}, h('h3', {}, '浮雕高度场'), h('div', { class: 'canvas-frame small' }, reliefCanvas)),
      ),
      h('h3', {}, '边缘陡度图（红＝针眼高危）'),
      h('div', { class: 'canvas-frame small' }, slopeCanvas),
      h('div', { class: 'stat-grid', style: 'margin-top:10px' },
        stat('最大凸起', `${fmt(maxH, 1)} μm`),
        stat('最大凹下', `${fmt(minH, 1)} μm`),
        stat('最大立面陡度', `${fmt(slope.maxSlope, 0)} μm/mm`),
        stat('针眼风险像素', String(riskCount), riskCount > 0 ? 'warn' : 'good'),
      ),
      h('div', { style: 'margin-top:10px' }, warn),
    ),
  );
}

function stat(k: string, v: string, cls = ''): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: `v ${cls}` }, v));
}
