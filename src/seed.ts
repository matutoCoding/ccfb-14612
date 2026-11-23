// 首次启动写入演示网模与浆料

import { dbAll, dbPut, Stores } from './lib/db';
import { buildMold, defaultBands, generateDemoPattern } from './lib/mold';
import { defaultFurnish } from './lib/furnish';
import { setFurnish, setMold } from './lib/session';
import type { FurnishDoc, MoldDoc } from './lib/types';

export async function ensureSeedData(): Promise<void> {
  const molds = await dbAll<MoldDoc>(Stores.molds);
  if (molds.length === 0) {
    const p1 = generateDemoPattern(560, 792, 'medallion');
    const m1 = buildMold('徽章椭圆防伪网模', p1.gray, p1.width, p1.height, defaultBands(), '内置演示：椭圆徽章+黑水印圆环');
    await dbPut(Stores.molds, m1);
    const p2 = generateDemoPattern(560, 792, 'text');
    const m2 = buildMold('证书斜纹文字网模', p2.gray, p2.width, p2.height, defaultBands(), '内置演示：斜排 CERTIFICATE 文字');
    await dbPut(Stores.molds, m2);
    setMold(m1);
  } else {
    setMold(molds[0]);
  }

  const furnishes = await dbAll<FurnishDoc>(Stores.furnishes);
  if (furnishes.length === 0) {
    const f1 = defaultFurnish('标准证书纸浆料');
    const f2: FurnishDoc = {
      ...defaultFurnish('高棉浆票据纸浆料'),
      id: `fur_seed_2`,
      name: '高棉浆票据纸浆料',
      softwood: 0.3,
      hardwood: 0.25,
      cotton: 0.45,
      beatingDegree: 55,
      headboxConsistency: 0.28,
      targetBasisWeight: 100,
      note: '棉浆占比高，耐折度好，收缩偏大',
    };
    await dbPut(Stores.furnishes, f1);
    await dbPut(Stores.furnishes, f2);
    setFurnish(f1);
  } else {
    setFurnish(furnishes[0]);
  }
}
