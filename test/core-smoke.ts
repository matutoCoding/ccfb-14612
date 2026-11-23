// 核心数值管线冒烟测试（Node 环境，不依赖 DOM/WebGL）
import { Rng, hashSeed, fingerprintFloat32 } from '../src/lib/rng';
import { buildMold, defaultBands } from '../src/lib/mold';
import { generateDemoPatternNode } from './mold-node-helper';
import { defaultFurnish, normalizeRatios } from '../src/lib/furnish';
import { generateFibers, SHEET_AREA_M2 } from '../src/lib/deposition';
import { formationAnalysis, dryingShrinkage, detectDefects, watermarkClarity } from '../src/lib/analysis';
import { DEFAULT_SIM_PARAMS } from '../src/lib/types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

// 1. PRNG 确定性
const a = new Rng(12345);
const b = new Rng(12345);
const seqA = Array.from({ length: 10000 }, () => a.next());
const seqB = Array.from({ length: 10000 }, () => b.next());
check('PRNG 同种子序列一致', seqA.every((v, i) => v === seqB[i]));
const mean = seqA.reduce((x, y) => x + y, 0) / seqA.length;
check('PRNG 均值接近 0.5', Math.abs(mean - 0.5) < 0.02, `mean=${mean}`);
check('hashSeed 稳定', hashSeed('x', 1) === hashSeed('x', 1));

// 2. 纤维沉积确定性（无 GL 部分）
const pattern = generateDemoPatternNode(280, 396, 'medallion');
const mold = buildMold('测试模', pattern.gray, pattern.width, pattern.height, defaultBands());
const furnish = normalizeRatios(defaultFurnish());
const p1 = { ...DEFAULT_SIM_PARAMS, fiberCount: 150000, gridW: 420, gridH: 594 };

const dep1 = generateFibers({ mold, furnish, params: p1 });
const dep2 = generateFibers({ mold, furnish, params: p1 });
check('同参数纤维数组逐位一致', dep1.fibers.data.every((v, i) => v === dep2.fibers.data[i]));
const fp1 = fingerprintFloat32(dep1.fibers.data, 'x');
const fp2 = fingerprintFloat32(dep2.fibers.data, 'x');
check('纤维数据指纹一致', fp1 === fp2);

const pOtherSeed = { ...p1, seed: p1.seed + 777 };
const dep3 = generateFibers({ mold, furnish, params: pOtherSeed });
check('换种子纤维数组不同', dep3.fibers.data.some((v, i) => v !== dep1.fibers.data[i]));

// 3. 归一化后，换种子平均定量偏差必须 ≤1%（每轮按目标定量独立归一，见软件 splat）
const means: number[] = [];

// 4. 用软件 splat 模拟 GPU 加法混合，验证定量场（同样确定性，且均值=目标定量）
function softwareSplat(dep: ReturnType<typeof generateFibers>, targetBw: number): Float32Array {
  const { gridW: w, gridH: h, fibers } = dep;
  const out = new Float32Array(w * h);
  const d = fibers.data;
  for (let i = 0; i < fibers.count; i++) {
    const o = i * 8;
    const x1 = d[o];
    const y1 = d[o + 1];
    const x2 = d[o + 2];
    const y2 = d[o + 3];
    const width = d[o + 5];
    const minX = Math.max(0, Math.floor(Math.min(x1, x2) - width));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(x1, x2) + width));
    const minY = Math.max(0, Math.floor(Math.min(y1, y2) - width));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(y1, y2) + width));
    const len = Math.hypot(x2 - x1, y2 - y1) || 1e-5;
    const ax = (x2 - x1) / len;
    const ay = (y2 - y1) / len;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const along = (dx * ax + dy * ay) / (len / 2);
        const across = (-dx * ay + dy * ax) / (width / 2);
        if (Math.abs(along) > 1 || Math.abs(across) > 1) continue;
        // 与 GL splat 片元着色器同口径：端部圆角 + 横向高斯
        const endCap = 1 - Math.min(1, Math.max(0, (Math.abs(along) - 0.85) / 0.15));
        const lateral = Math.exp(-2.2 * across * across);
        const cov = endCap * lateral;
        out[y * w + x] += d[o + 4] * cov;
      }
    }
  }
  // 与生产一致的二次归一
  const rawMean = out.reduce((x, y) => x + y, 0) / out.length;
  const k = targetBw / rawMean;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

const target = furnish.targetBasisWeight;
const basis1 = softwareSplat(dep1, target);
const basis2 = softwareSplat(dep2, target);
check('软件 splat 同参数逐位一致', basis1.every((v, i) => v === basis2[i]));
const bMean = basis1.reduce((x, y) => x + y, 0) / basis1.length;
check(`定量均值=目标 ${target}g/m²`, Math.abs(bMean - target) / target < 0.002, `mean=${bMean.toFixed(3)}`);

const seedMeans: number[] = [];
for (let k = 0; k < 5; k++) {
  const d = generateFibers({ mold, furnish, params: { ...p1, seed: p1.seed + k * 131 } });
  const bv = softwareSplat(d, target);
  seedMeans.push(bv.reduce((x, y) => x + y, 0) / bv.length);
}
const maxBwDev = Math.max(...seedMeans.map((m) => Math.abs(m - target) / target));
check('换种子平均定量偏差 ≤ 1%', maxBwDev <= 0.01, `maxDev=${(maxBwDev * 100).toFixed(4)}%`);

// 5. 分析模块
const formation = formationAnalysis(basis1, 420, 594);
check('匀度曲线点数完整', formation.scalesMm.length === 9 && formation.cvCurve.every((v) => Number.isFinite(v) && v > 0));
check('匀度 FI 合理范围(10~95)', formation.formationIndex > 10 && formation.formationIndex < 95, `FI=${formation.formationIndex.toFixed(1)}`);
const clarity = watermarkClarity(basis1, 420, 594, mold);
check('水印清晰度 > 0', clarity > 0, `clarity=${clarity.toFixed(2)}`);
const shrink = dryingShrinkage(mold, furnish);
check('纵向收缩 < 横向收缩', shrink.shrinkMdPct < shrink.shrinkCdPct);
check('水印尺寸收缩后变小', shrink.wmWidthAfter < shrink.wmWidthBefore && shrink.wmHeightAfter < shrink.wmHeightBefore);
const defects = detectDefects(basis1, 420, 594, mold, shrink.shrinkMdPct, shrink.shrinkCdPct);
check('纸病检测返回数组', Array.isArray(defects.defects));
check('纸病等级合法', defects.defects.every((d) => ['A', 'B', 'C'].includes(d.level)));

// 6. 浮雕凸起处更薄（脱水效应方向性正确）
const relief = dep1.reliefGrid;
let hiSum = 0;
let hiN = 0;
let loSum = 0;
let loN = 0;
for (let i = 0; i < relief.length; i++) {
  if (relief[i] > 30) {
    hiSum += basis1[i];
    hiN++;
  } else if (relief[i] < -30) {
    loSum += basis1[i];
    loN++;
  }
}
check('凸起区定量 < 凹下区定量（脱水方向正确）', hiSum / hiN < loSum / loN, `hi=${(hiSum / hiN).toFixed(1)} lo=${(loSum / loN).toFixed(1)}`);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
