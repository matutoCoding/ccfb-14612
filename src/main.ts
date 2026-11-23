import './styles.css';
import { h, mount } from './lib/dom';
import { getState, subscribe } from './lib/session';
import { renderMoldPage } from './pages/mold-page';
import { renderFurnishPage } from './pages/furnish-page';
import { renderSimulationPage } from './pages/simulation-page';
import { renderLightPage } from './pages/light-page';
import { renderDefectPage } from './pages/defect-page';
import { renderProofPage } from './pages/proof-page';
import { ensureSeedData } from './seed';

const ROUTES: { hash: string; label: string; ico: string; render: (root: HTMLElement) => void }[] = [
  { hash: '#/mold', label: '网模设计', ico: '▣', render: renderMoldPage },
  { hash: '#/furnish', label: '浆料配方', ico: '❖', render: renderFurnishPage },
  { hash: '#/sim', label: '抄造仿真', ico: '⚙', render: renderSimulationPage },
  { hash: '#/light', label: '透光观察', ico: '☼', render: renderLightPage },
  { hash: '#/defect', label: '纸病分析', ico: '◉', render: renderDefectPage },
  { hash: '#/proof', label: '打样记录', ico: '✎', render: renderProofPage },
];

function currentRoute(): string {
  const hash = location.hash || '#/mold';
  return ROUTES.some((r) => r.hash === hash) ? hash : '#/mold';
}

let navEl: HTMLElement;
let contextEl: HTMLElement;
let mainEl: HTMLElement;
let currentRouteHash = '';

function renderNav(): void {
  const route = currentRoute();
  navEl.replaceChildren(
    ...ROUTES.map((r) =>
      h('a', { href: r.hash, class: route === r.hash ? 'active' : '' }, h('span', { class: 'nav-ico' }, r.ico), r.label),
    ),
  );
}

function renderContext(): void {
  const s = getState();
  contextEl.replaceChildren(
    h('b', {}, '当前网模'),
    h('span', {}, s.currentMold ? `${s.currentMold.name} v${s.currentMold.version}` : '未选择'),
    h('b', { style: 'margin-top:8px' }, '当前浆料'),
    h('span', {}, s.currentFurnish ? s.currentFurnish.name : '未选择'),
    h('b', { style: 'margin-top:8px' }, '最近仿真'),
    h('span', {}, s.lastSimulation ? s.lastSimulation.record.name : '未运行'),
  );
}

function renderRoute(): void {
  const route = currentRoute();
  if (route === currentRouteHash) return; // 状态变化不重建页面，避免递归与状态丢失
  currentRouteHash = route;
  renderNav();
  mainEl.replaceChildren();
  const active = ROUTES.find((r) => r.hash === route)!;
  active.render(mainEl);
}

function renderShell(): void {
  const nav = h('nav', { class: 'nav' });
  navEl = nav;
  contextEl = h('div', { class: 'context-card' });
  const sidebar = h(
    'aside',
    { class: 'sidebar' },
    h('div', { class: 'brand' }, '水印网模设计与抄造成形仿真', h('small', {}, '防伪水印纸 · WebGL2 成形仿真')),
    nav,
    contextEl,
  );
  mainEl = h('main', {});
  currentRouteHash = '';
  mount(document.getElementById('app')!, h('div', { style: 'display:contents' }, sidebar, mainEl));
  renderRoute();
  renderContext();
}

window.addEventListener('hashchange', renderRoute);

async function boot(): Promise<void> {
  await ensureSeedData();
  // 状态变化只刷新侧栏上下文，不重建主区域（页面内部自行决定是否重绘）
  subscribe(renderContext);
  renderShell();
}

boot().catch((e) => {
  document.getElementById('app')!.append(h('div', { class: 'danger-box', style: 'margin:30px' }, `启动失败：${(e as Error).message}`));
});
