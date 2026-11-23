import { generateDemoPatternNode } from './mold-node-helper';
import { buildMold, defaultBands } from '../src/lib/mold';
import { defaultFurnish, normalizeRatios } from '../src/lib/furnish';
import { generateFibers } from '../src/lib/deposition';
import { formationAnalysis, detectDefects, dryingShrinkage } from '../src/lib/analysis';
import { DEFAULT_SIM_PARAMS } from '../src/lib/types';

const pattern = generateDemoPatternNode(560, 792, 'medallion');
const mold = buildMold('perf', pattern.gray, pattern.width, pattern.height, defaultBands());
const furnish = normalizeRatios(defaultFurnish());
const params = { ...DEFAULT_SIM_PARAMS }; // 300000 纤维, 840x1188
const t0 = performance.now();
const dep = generateFibers({ mold, furnish, params });
const t1 = performance.now();
console.log(`纤维生成 ${params.fiberCount} 根: ${(t1 - t0).toFixed(0)}ms`);

// 软件 splat 计时（浏览器里由 GPU 完成，这里只估 CPU 分析开销基线）
const t2 = performance.now();
const f = formationAnalysis(new Float32Array(params.gridW * params.gridH).map((_, i) => 90 + Math.sin(i / 17) * 4), params.gridW, params.gridH);
const sh = dryingShrinkage(mold, furnish);
const t3 = performance.now();
console.log(`匀度分析: ${(t3 - t2).toFixed(0)}ms, FI=${f.formationIndex.toFixed(1)}`);
const t4 = performance.now();
detectDefects(new Float32Array(params.gridW * params.gridH).fill(90), params.gridW, params.gridH, mold, sh.shrinkMdPct, sh.shrinkCdPct);
const t5 = performance.now();
console.log(`纸病检测(连通域): ${(t5 - t4).toFixed(0)}ms`);
console.log(`内存占用 纤维数组: ${(dep.fibers.data.byteLength / 1024 / 1024).toFixed(1)}MB, 浮雕+絮聚: ${((dep.reliefGrid.byteLength + dep.flocField.byteLength) / 1024 / 1024).toFixed(1)}MB`);
