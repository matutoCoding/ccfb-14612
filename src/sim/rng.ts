// ===== 确定性随机数（同一 seed 全链路可复现）=====
// PCG hash + 计数器 PRNG，无 Math.random，Web Worker / GPU 种子派生同算法

/** 32 位整数混合哈希（SplitMix32 风格） */
export function mix32(a: number): number {
  a |= 0;
  a = (a + 0x9e3779b9) | 0;
  let t = Math.imul(a ^ (a >>> 16), 0x21f0aaad);
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
  return (t ^ (t >>> 15)) >>> 0;
}

/** 字符串 -> 32bit seed（FNV-1a 变体） */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 可复制、可跳转的确定性 PRNG */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = (seed | 0) || 1;
  }
  /** [0, 2^32) */
  nextU32(): number {
    // PCG-XSH-RR 32 位版
    let old = this.state | 0;
    this.state = (Math.imul(old, 747796405) + 2891336453) | 0;
    let w = ((old >>> ((old >>> 28) + 4)) ^ old) >>> 0;
    w = Math.imul(w, 277803737);
    return (w ^ (w >>> 22)) >>> 0;
  }
  /** [0,1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }
  /** 均匀分布 [min,max) */
  uniform(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  /** 正态分布（Box-Muller，均值 mu 标准差 sigma，确定性） */
  gaussian(mu = 0, sigma = 1): number {
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mu + z * sigma;
  }
  /** 截断正态（约 ±3σ 内重采样，最多重试 8 次） */
  truncatedGaussian(mu: number, sigma: number, lo: number, hi: number): number {
    for (let i = 0; i < 8; i++) {
      const v = this.gaussian(mu, sigma);
      if (v >= lo && v <= hi) return v;
    }
    return Math.min(hi, Math.max(lo, this.gaussian(mu, sigma)));
  }
  /** 按权重抽索引 */
  weightedIndex(weights: ArrayLike<number>): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }
  /** 冯·米塞斯近似（围绕 meanAngle 的取向，kappa 越大越集中） */
  wrappedAngle(meanAngle: number, kappa: number): number {
    // 用截断正态近似包裹正态
    const sigma = 1 / Math.sqrt(Math.max(kappa, 1e-3));
    let a = this.gaussian(meanAngle, sigma);
    a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return a;
  }
  fork(salt: number): Rng {
    return new Rng(mix32(this.state ^ mix32(salt)));
  }
}

/** 给某根纤维派生 GPU/CPU 共用的逐纤维种子 */
export function fiberSeed(baseSeed: number, fiberIndex: number, salt: number): number {
  return mix32(mix32(baseSeed ^ Math.imul(fiberIndex + 1, 0x9e3779b1)) ^ salt);
}
