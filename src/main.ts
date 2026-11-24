import './styles.css';
import { currentRoute, onRouteChange, renderTopbar, type RouteName } from './router';
import { h, clearEl } from './ui/dom';
import { listMolds, listRecipes, listSims } from './db';
import { setState } from './state';
import { renderMoldPage } from './pages/moldPage';
import { renderPulpPage } from './pages/pulpPage';
import { renderSimPage } from './pages/simPage';
import { renderLightPage } from './pages/lightPage';
import { renderDefectPage } from './pages/defectPage';
import { renderProofPage } from './pages/proofPage';

const RENDERERS: Record<RouteName, (root: HTMLElement) => Promise<void> | void> = {
  mold: renderMoldPage,
  pulp: renderPulpPage,
  sim: renderSimPage,
  light: renderLightPage,
  defect: renderDefectPage,
  proof: renderProofPage,
};

async function bootstrap(): Promise<void> {
  const app = document.getElementById('app')!;
  const [molds, recipes, sims] = await Promise.all([listMolds(), listRecipes(), listSims()]);
  setState({ molds, recipes, sims });

  const render = (): void => {
    const route = currentRoute();
    clearEl(app);
    app.append(renderTopbar(route));
    const main = h('main');
    app.append(main);
    Promise.resolve(RENDERERS[route](main)).catch((err) => {
      console.error(err);
      main.append(
        h('div', { class: 'panel' }, h('h3', {}, '页面渲染失败'), h('pre', { style: { color: '#f0645e' } }, String(err?.stack || err))),
      );
    });
  };
  onRouteChange(render);
  render();
}

bootstrap();
