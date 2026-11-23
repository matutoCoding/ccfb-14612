// 透光观察页：透射/反射切换、光源角度、纸张翻面

import { getEngine } from '../engine-singleton';
import { button, clear, fmt, h, labeledField, slider, toast } from '../lib/page-utils';
import { getState, setLightSettings } from '../lib/session';
import type { ViewMode } from '../lib/gl-engine';

export function renderLightPage(root: HTMLElement): void {
  clear(root);
  const session = getState().lastSimulation;
  const light = getState();

  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, '透光观察'), h('p', {}, '透射按纤维层厚度做 Beer-Lambert 衰减，水印层次分明；反射为表面漫反射，水印几乎不可见。支持光源角度与纸张翻面。')),
  );

  if (!session || !session.glTextures) {
    root.append(h('div', { class: 'warn-box card' }, '请先在「抄造仿真」页运行一次仿真。'));
    return;
  }

  const left = h('div', {});
  const right = h('div', {});
  root.append(h('div', { class: 'layout-2 narrow-left' }, left, right));

  const frame = h('div', { class: 'canvas-frame' }, h('canvas', {}));
  const info = h('div', { class: 'card' });

  left.append(
    h('div', { class: 'card' }, h('h2', {}, '观察方式'),
      h('div', { class: 'btn-row' },
        modeBtn('透射（背光）', 'trans'),
        modeBtn('反射（正面光）', 'reflect'),
      ),
      h('div', { style: 'margin-top:12px' },
        labeledField(`光源角度 ${fmt(light.lightAngleDeg, 0)}°`, slider(light.lightAngleDeg, -60, 60, 1, (v) => {
          setLightSettings({ lightAngleDeg: v });
          renderLightPage(document.querySelector('main')!);
        })),
        h('label', { class: 'checkline' }, h('input', { type: 'checkbox', checked: light.sheetFlipped, onChange: () => setLightSettings({ sheetFlipped: !light.sheetFlipped }) }), '纸张翻面（背向观察者）'),
      ),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        button('导出当前视图 PNG', () => {
          const c = frame.querySelector('canvas') as HTMLCanvasElement;
          const a = h('a', { href: c.toDataURL('image/png'), download: `watermark-${light.lightMode}.png` }) as HTMLAnchorElement;
          a.click();
          toast('已导出');
        }),
      ),
    ),
    info,
  );

  right.append(h('div', { class: 'card' }, h('h2', {}, light.lightMode === 'trans' ? '透射光视图' : '反射光视图'), frame));
  draw(frame, info);

  function modeBtn(label: string, mode: 'trans' | 'reflect'): HTMLElement {
    return button(label, () => {
      setLightSettings({ lightMode: mode });
      renderLightPage(document.querySelector('main')!);
    }, light.lightMode === mode);
  }
}

function draw(frame: HTMLElement, info: HTMLElement): void {
  const s = getState();
  const session = s.lastSimulation!;
  const engine = getEngine();
  const mode: ViewMode = s.lightMode === 'trans' ? 1 : 2;
  try {
    engine.renderView(mode, session.glTextures!.reliefTex, session.glTextures!.flocTex, (s.lightAngleDeg * Math.PI) / 180, s.sheetFlipped, session.glTextures!.emboss);

    const target = frame.querySelector('canvas') as HTMLCanvasElement;
    target.width = engine.canvas.width;
    target.height = engine.canvas.height;
    target.getContext('2d')!.drawImage(engine.canvas, 0, 0);
  } catch (e) {
    console.error('透光渲染失败', e);
    frame.append(h('div', { class: 'danger-box' }, `渲染失败：${(e as Error).message}`));
  }

  info.replaceChildren(
    h('h2', {}, '光学说明'),
    s.lightMode === 'trans'
      ? h('div', { class: 'ok-box' }, '透射模式：凸起压薄处光程短、透过率高，白水印亮；凹下区域光程长偏暗，水印层次分明。光源斜射时光程 ×1/cosθ，整体变暗。')
      : h('div', { class: 'warn-box' }, '反射模式：人眼看到的是表面漫反射，厚度差异贡献仅 4%，水印几乎看不出——与实际纸面反射观察一致。'),
    h('p', { class: 'muted', style: 'margin-top:8px' }, `当前角度 ${fmt(s.lightAngleDeg, 0)}°，${s.sheetFlipped ? '纸张已翻面' : '正面朝上'}。翻面后视图垂直镜像。`),
  );
}
