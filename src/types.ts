// ===== 全局领域类型 =====

/** 浮雕高度分档（档值单位 μm，凸起为正=白水印，凹下为负=黑水印） */
export interface ReliefLevel {
  id: string;
  /** 灰度阈值下界 [0,1) */
  grayMin: number;
  /** 灰度阈值上界 (0,1] */
  grayMax: number;
  /** 浮雕高度 μm，正=凸起（白水印），负=凹下（黑水印），0=平面 */
  heightUm: number;
  label: string;
}

export interface MoldDesign {
  id: string;
  name: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** 设计幅面 mm */
  widthMm: number;
  heightMm: number;
  /** 浮雕栅格分辨率（像素/100mm），决定浮雕纹理尺寸 */
  gridRes: number;
  levels: ReliefLevel[];
  /** 生成的浮雕高度场（μm，长度 gridW*gridH），不入库、单独存 blob */
  relief?: Float32Array;
  gridW?: number;
  gridH?: number;
  /** 原始灰度图缩略 dataURL */
  sourceThumb?: string;
  /** 针眼风险统计（设计时计算） */
  pinholeRiskCount?: number;
  pinholeRiskFraction?: number;
  note?: string;
}

export interface FiberComponent {
  id: string;
  name: string;
  /** 质量配比 %，三项之和应≈100 */
  ratio: number;
  /** 平均纤维长度 mm */
  meanLengthMm: number;
  /** 长度分布 CV（变异系数） */
  lengthCv: number;
  /** 纤维粗度 mg/m */
  coarsenessMgPerM: number;
  /** 打浆度 °SR */
  beatingDegreeSR: number;
}

export interface PulpRecipe {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  components: FiberComponent[];
  /** 上网浓度 % */
  headboxConsistency: number;
  /** 上网流速 m/min */
  jetSpeed: number;
  /** 絮聚系数（0~1，配合浓度流速动态修正） */
  flocBase: number;
  /** 湿纸幅目标定量 g/m² */
  targetBasisWeight: number;
  note?: string;
}

export interface SimParams {
  moldId: string;
  recipeId: string;
  seed: number;
  /** 仿真幅面（沿用网模幅面） */
  widthMm: number;
  heightMm: number;
  /** 纤维沉积栅格 px（短边） */
  gridSize: number;
  /** 纤维总根数（几十万级） */
  fiberCount: number;
  /** 随机取向强度 0=完全顺流 1=完全随机 */
  orientationRandomness: number;
}

export interface DefectRecord {
  kind: 'pinhole' | 'thinSpot' | 'floc' | 'watermarkDistortion';
  cx: number; // 归一化坐标 0~1
  cy: number;
  /** 等效半径 mm */
  radiusMm: number;
  areaMm2: number;
  /** 分级 1 轻微 2 中等 3 严重 */
  grade: 1 | 2 | 3;
  measure: number;
}

export interface SimResult {
  id: string;
  params: SimParams;
  moldName: string;
  recipeName: string;
  createdAt: number;
  elapsedMs: number;
  // —— 统计 ——
  meanBasisWeight: number;
  stdBasisWeight: number;
  cvBasisWeight: number; // 定量波动 CV %
  formationIndex: number; // 匀度指数
  /** 多尺度波动曲线：尺度(mm) -> 方差 */
  scaleCurve: { scaleMm: number; variance: number }[];
  clarity: number; // 水印清晰度 0~100
  defects: DefectRecord[];
  defectCounts: Record<DefectRecord['kind'], number>;
  // —— 干燥收缩 ——
  shrinkMD: number; // 纵向 %
  shrinkCD: number; // 横向 %
  watermarkSizeDrift: { mdPct: number; cdPct: number; tolerancePct: number; pass: boolean };
  // —— GPU 纹理回读的场（不入库）——
  thicknessField?: Float32Array;
  orientationField?: Float32Array; // 每格 2 分量
  gridW?: number;
  gridH?: number;
  widthMm: number;
  heightMm: number;
}

export interface ProofRecord {
  id: string;
  name: string;
  createdAt: number;
  moldId: string;
  moldVersion: number;
  recipeId: string;
  recipeBatch: string;
  simId?: string;
  /** 实拍透光照片 dataURL */
  photoDataUrl?: string;
  /** 仿真透光图 dataURL（打样时从仿真结果生成） */
  simDataUrl?: string;
  note?: string;
  /** 人工评价 */
  rating?: number;
}

export interface BatchCompareRow {
  simId: string;
  recipeName: string;
  seed: number;
  formationIndex: number;
  clarity: number;
  defectTotal: number;
  cvBasisWeight: number;
  meanBasisWeight: number;
  elapsedMs: number;
}
