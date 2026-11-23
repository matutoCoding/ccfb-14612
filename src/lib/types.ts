// 全局数据模型与常量

export interface MoldBand {
  /** 该档对应的灰度中心 0..255 */
  gray: number;
  /** 浮雕高度 um，正=凸起(白水印)，负=凹下(黑水印)，0=平面 */
  heightUm: number;
}

export interface MoldDoc {
  id: string;
  name: string;
  version: number;
  parentId: string | null;
  width: number; // 像素
  height: number;
  /** 归一化灰度 0..1，row-major, length = width*height */
  gray: Float32Array;
  bands: MoldBand[];
  /** 浮雕高度场 um，row-major，由 bands 映射生成 */
  relief: Float32Array;
  maxHeightUm: number;
  minHeightUm: number;
  /** 针眼风险：梯度过陡像素数 */
  pinholeRiskCount: number;
  createdAt: number;
  note: string;
}

export interface FurnishDoc {
  id: string;
  name: string;
  softwood: number; // 针叶浆比例 0..1
  hardwood: number; // 阔叶浆比例 0..1
  cotton: number; // 棉浆比例 0..1
  swLengthMm: number;
  swCoarsenessMg: number; // mg/100m
  hwLengthMm: number;
  hwCoarsenessMg: number;
  cotLengthMm: number;
  cotCoarsenessMg: number;
  beatingDegree: number; // 打浆度 °SR
  headboxConsistency: number; // 上网浓度 %
  flowSpeed: number; // 流速 m/min
  targetBasisWeight: number; // 目标定量 g/m2
  updatedAt: number;
  note: string;
}

export interface SimParams {
  fiberCount: number;
  seed: number;
  gridW: number;
  gridH: number;
  /** 絮聚强度系数 0..1 */
  flocIntensity: number;
  /** 纵向取向偏好 0..1 */
  mdOrientation: number;
}

export interface SimStats {
  meanBasisWeight: number;
  stdBasisWeight: number;
  cvPercent: number;
  minBw: number;
  maxBw: number;
  /** 换种子平均定量偏差（归一化后为 0，这里记录归一化前的原始偏差） */
  rawMeanBw: number;
  formationIndex: number;
  clarity: number;
  defectCounts: { pinhole: number; thin: number; floc: number; distortion: number };
  shrinkMdPct: number;
  shrinkCdPct: number;
  wmWidthBefore: number;
  wmWidthAfter: number;
  wmHeightBefore: number;
  wmHeightAfter: number;
  wmTolerancePct: number;
  wmOutOfTolerance: boolean;
  elapsedMs: number;
}

export interface SimRecord {
  id: string;
  name: string;
  moldId: string;
  moldVersion: number;
  moldName: string;
  furnishId: string;
  furnishName: string;
  params: SimParams;
  stats: SimStats;
  createdAt: number;
  /** 仿真结果纹理的缩略 dataURL（定量/透射/反射） */
  thumbBasis: string;
  thumbTrans: string;
  thumbReflect: string;
  /** 数据指纹：同模同浆同种子应一致 */
  fingerprint: string;
}

export interface ProofRecord {
  id: string;
  name: string;
  simId: string | null;
  moldId: string;
  moldVersion: number;
  furnishId: string;
  furnishBatch: string;
  createdAt: number;
  /** 实测透光照片 dataURL */
  photoDataUrl: string;
  note: string;
  /** 人工评价 */
  clarityScore: number; // 1..5
  defectCountObserved: number;
}

export interface BenchmarkDoc {
  id: string;
  name: string;
  /** 各尺度(mm)下的标准 CV% 曲线点 */
  scalesMm: number[];
  cvCurve: number[];
  formationIndex: number;
  note: string;
}

export interface SimSessionData {
  record: SimRecord;
  mold: MoldDoc;
  furnish: FurnishDoc;
  /** 定量场 g/m2，分析网格分辨率 */
  basisGrid: Float32Array;
  gridW: number;
  gridH: number;
  thicknessGrid: Float32Array;
  /** 多尺度波动画曲线 */
  scaleCurve: { scalesMm: number[]; cvCurve: number[] };
  defects: DefectItem[];
  fibers: PackedFibers;
  /** 最近一次 GL 运行的纹理（仅内存，不落库） */
  glTextures?: {
    reliefTex: WebGLTexture;
    flocTex: WebGLTexture;
    emboss: number;
  };
}

export interface PackedFibers {
  /** 每根纤维 8 个 float: x1,y1,x2,y2,mass,width,species,angle0 */
  data: Float32Array;
  count: number;
}

export interface DefectItem {
  kind: 'pinhole' | 'thin' | 'floc' | 'distortion';
  cx: number; // 归一化 0..1
  cy: number;
  rx: number; // 归一化半径
  ry: number;
  areaMm2: number;
  level: 'A' | 'B' | 'C';
  measure: number;
}

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

export const DEFAULT_SIM_PARAMS: SimParams = {
  fiberCount: 300000,
  seed: 20261123,
  gridW: 840,
  gridH: 1188,
  flocIntensity: 0.6,
  mdOrientation: 0.35,
};

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function nowTs(): number {
  return Date.now();
}
