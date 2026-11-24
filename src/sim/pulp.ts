// ===== 浆料配方与纤维群体模型 =====
import type { FiberComponent, PulpRecipe } from '../types';
import { Rng } from './rng';

export const DEFAULT_COMPONENTS: FiberComponent[] = [
  { id: 'softwood', name: '针叶木浆', ratio: 45, meanLengthMm: 2.4, lengthCv: 0.35, coarsenessMgPerM: 0.18, beatingDegreeSR: 32 },
  { id: 'hardwood', name: '阔叶木浆', ratio: 35, meanLengthMm: 0.9, lengthCv: 0.42, coarsenessMgPerM: 0.1, beatingDegreeSR: 28 },
  { id: 'cotton', name: '棉浆', ratio: 20, meanLengthMm: 12.0, lengthCv: 0.55, coarsenessMgPerM: 0.24, beatingDegreeSR: 40 },
];

export function makeDefaultRecipe(name = '标准防伪纸浆料'): PulpRecipe {
  const now = Date.now();
  return {
    id: `recipe_${now.toString(36)}`,
    name,
    createdAt: now,
    updatedAt: now,
    components: DEFAULT_COMPONENTS.map((c) => ({ ...c })),
    headboxConsistency: 0.6,
    jetSpeed: 60,
    flocBase: 0.35,
    targetBasisWeight: 90,
  };
}

export function ratioSum(r: PulpRecipe): number {
  return r.components.reduce((s, c) => s + c.ratio, 0);
}

/** 配比加权后的群体平均属性 */
export interface BlendProps {
  meanLength: number;
  meanCoarseness: number;
  meanBeating: number;
  /** 混合后长度分布的等效 CV（组内+组间） */
  blendCv: number;
  weights: number[];
}

export function blendProperties(r: PulpRecipe): BlendProps {
  const total = Math.max(1e-6, ratioSum(r));
  const weights = r.components.map((c) => c.ratio / total);
  let meanLength = 0;
  let meanCoarseness = 0;
  let meanBeating = 0;
  r.components.forEach((c, i) => {
    meanLength += weights[i] * c.meanLengthMm;
    meanCoarseness += weights[i] * c.coarsenessMgPerM;
    meanBeating += weights[i] * c.beatingDegreeSR;
  });
  // 混合方差 = E[组内方差] + Var(组均值)
  let within = 0;
  let between = 0;
  r.components.forEach((c, i) => {
    within += weights[i] * (c.lengthCv * c.meanLengthMm) ** 2;
    between += weights[i] * (c.meanLengthMm - meanLength) ** 2;
  });
  const blendCv = Math.sqrt(within + between) / meanLength;
  return { meanLength, meanCoarseness, meanBeating, blendCv, weights };
}

export interface FiberSpec {
  /** 所属组元索引 */
  component: number;
  lengthMm: number;
  widthUm: number;
  coarseness: number;
}

/**
 * 按配比与截断对数正态生成整批纤维规格（长度分布程序自动生成，同一 seed 完全确定）
 */
export function generateFiberPopulation(r: PulpRecipe, count: number, seed: number): FiberSpec[] {
  const rng = new Rng(seed);
  const blend = blendProperties(r);
  const out: FiberSpec[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const ci = rng.weightedIndex(blend.weights);
    const c = r.components[ci];
    // 对数正态参数：由均值与 CV 反推
    const cv = c.lengthCv;
    const sigma = Math.sqrt(Math.log(1 + cv * cv));
    const mu = Math.log(c.meanLengthMm) - 0.5 * sigma * sigma;
    let L = Math.exp(rng.gaussian(mu, sigma));
    // 截断到合理物理范围
    L = Math.min(18, Math.max(0.2, L));
    // 纤维宽度与粗度相关，阔叶 15~25μm，针叶 25~40μm，棉 15~30μm
    const widthUm = rng.truncatedGaussian(
      ci === 1 ? 19 : ci === 0 ? 31 : 22,
      3.2,
      10,
      48,
    );
    out[i] = { component: ci, lengthMm: L, widthUm, coarseness: c.coarsenessMgPerM };
  }
  return out;
}

/** 长度分布直方图（多组元叠加），供页面画图 */
export function lengthDistributionHistogram(
  r: PulpRecipe,
  seed: number,
  bins = 26,
): { edges: number[]; counts: number[]; perComponent: number[][] } {
  const pop = generateFiberPopulation(r, 12000, seed);
  const maxL = 16;
  const edges = Array.from({ length: bins + 1 }, (_, i) => (maxL * i) / bins);
  const counts = new Array(bins).fill(0);
  const perComponent = r.components.map(() => new Array(bins).fill(0));
  for (const f of pop) {
    const b = Math.min(bins - 1, Math.floor((f.lengthMm / maxL) * bins));
    counts[b]++;
    perComponent[f.component][b]++;
  }
  return { edges, counts, perComponent };
}

/**
 * 絮聚程度：基础絮聚系数 × 浓度/流速修正。
 * 浓度越高、流速越低（剪切弱）絮聚越重；打浆度高也促进絮聚。
 */
export function flocculationLevel(r: PulpRecipe): number {
  const blend = blendProperties(r);
  const concFactor = 0.55 + r.headboxConsistency * 0.75; // 0.6% -> ~1.0
  const speedFactor = 70 / Math.max(20, r.jetSpeed); // 60m/min -> 1.17
  const beatingFactor = 0.85 + blend.meanBeating / 120; // 35°SR -> ~1.14
  return Math.min(1, r.flocBase * concFactor * speedFactor * beatingFactor);
}

/** 由目标定量与纤维粗度反推单位面积纤维根数（用于确定沉积总量） */
export function fibersPerM2(r: PulpRecipe): number {
  const blend = blendProperties(r);
  // 单根质量 ≈ 粗度(mg/m) × 长度(m)
  const massPerFiberMg = blend.meanCoarseness * (blend.meanLength / 1000);
  // 定量 g/m² = 定量*1000 mg/m²
  return (r.targetBasisWeight * 1000) / massPerFiberMg;
}
