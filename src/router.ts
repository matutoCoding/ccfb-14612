// ===== 哈希路由 =====
export type RouteName =
  | 'mold'
  | 'pulp'
  | 'sim'
  | 'light'
  | 'defect'
  | 'proof';

const ROUTES: { name: RouteName; label: string; icon: string }[] = [
  { name: 'mold', label: '网模设计', icon: '▣' },
  { name: 'pulp', label: '浆料配方', icon: '≋' },
  { name: 'sim', label: '抄造仿真', icon: '⚙' },
  { name: 'light', label: '透光观察', icon: '☀' },
  { name: 'defect', label: '纸病分析', icon: '◉' },
  { name: 'proof', label: '打样记录', icon: '✎' },
];

export function currentRoute(): RouteName {
  const r = location.hash.replace('#/', '') as RouteName;
  return (ROUTES.some((x) => x.name === r) ? r : 'mold') as RouteName;
}

export function navigate(name: RouteName): void {
  location.hash = `#/${name}`;
}

export function renderTopbar(active: RouteName): HTMLElement {
  const bar = document.createElement('nav');
  bar.className = 'topbar';
  bar.append(
    (() => {
      const d = document.createElement('div');
      d.className = 'brand';
      d.innerHTML = `<span class="logo">水</span>水印网模仿真系统`;
      return d;
    })(),
  );
  for (const r of ROUTES) {
    const a = document.createElement('a');
    a.className = 'nav-item' + (r.name === active ? ' active' : '');
    a.href = `#/${r.name}`;
    a.textContent = `${r.icon} ${r.label}`;
    bar.append(a);
  }
  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  const pill = document.createElement('span');
  pill.className = 'env-pill';
  pill.textContent = 'WebGL2 · IndexedDB · 本地运行';
  bar.append(spacer, pill);
  return bar;
}

export function onRouteChange(cb: (r: RouteName) => void): () => void {
  const handler = () => cb(currentRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
