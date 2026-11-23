// 确定性随机数：全部仿真过程只允许使用这里的 PRNG，禁止 Math.random 进入数据管线
// mulberry32 + 可选哈希组合，保证同种子逐位复现

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** [0,1) 均匀分布 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 均值 0、标准差 1 的正态分布（Box-Muller） */
  gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /** 截断正态：均值 mu、标准差 sigma，截断在 [lo, hi] */
  truncatedGaussian(mu: number, sigma: number, lo: number, hi: number): number {
    for (let i = 0; i < 12; i++) {
      const x = mu + this.gaussian() * sigma;
      if (x >= lo && x <= hi) return x;
    }
    return Math.min(hi, Math.max(lo, mu + this.gaussian() * sigma));
  }

  /** 对数正态采样（纤维长度分布用） */
  lognormal(median: number, sigmaGeo: number): number {
    return median * Math.exp(this.gaussian() * Math.log(sigmaGeo));
  }

  pickIndex(weights: number[]): number {
    const r = this.next();
    let acc = 0;
    const total = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i] / total;
      if (r < acc) return i;
    }
    return weights.length - 1;
  }
}

/** 字符串/数组 -> 32bit 种子哈希 */
export function hashSeed(...parts: (number | string)[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = Math.imul(h ^ (h >>> 13), 3266489917);
  }
  return h >>> 0;
}

/** 32 位浮点数组指纹（FNV-1a 按字节），用于复现性校验 */
export function fingerprintFloat32(arr: Float32Array, meta: string): string {
  let h1 = 0xdeadbeef ^ meta.length;
  let h2 = 0x41c6ce57 ^ meta.length;
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  for (let i = 0; i < meta.length; i++) {
    h1 = Math.imul(h1 ^ meta.charCodeAt(i), 2654435761);
    h2 = Math.imul(h2 ^ meta.charCodeAt(i), 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(13, '0');
}
