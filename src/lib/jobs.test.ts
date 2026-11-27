import { describe, expect, it } from 'vitest';
import { canJoinNow, eligibility } from './age';
import { CATEGORIES, FACILITIES, JOBS, economyKind, jobById, matchesQuery, pinsForFloor } from './jobs';

describe('jobs.json', () => {
  it('43 個職業、31 個設施、2 個待確認', () => {
    expect(JOBS).toHaveLength(43);
    expect(FACILITIES).toHaveLength(31);
    expect(JOBS.filter((j) => j.flag === '待確認').map((j) => j.id)).toEqual(['job-pizza-chef', 'job-kzu-university']);
  });

  it('品牌欄位無頭尾空白；救護員品牌已修正', () => {
    for (const j of JOBS) if (j.sponsor) expect(j.sponsor).toBe(j.sponsor.trim());
    expect(jobById('job-paramedic')?.sponsor).toBe('國泰健康園區 Cathay Health Park 急診室');
    expect(jobById('job-yakiniku')?.sponsor).toBe('橘炎 Ju Yan');
  });

  it('空白欄位保持 null，不補值', () => {
    const kzu = jobById('job-kzu-university')!;
    expect([kzu.minAge, kzu.kidzoDelta, kzu.ntdFee, kzu.durationMin, kzu.officialUrl]).toEqual([null, null, null, null, null]);
    const pizza = jobById('job-pizza-chef')!;
    expect(pizza.kidzoDelta).toBeNull();
    expect(pizza.ntdFee).toBeNull();
  });

  it('description 原文保留，備註另拆', () => {
    const y = jobById('job-yakiniku')!;
    expect(y.description).toContain(y.summary!);
    expect(y.description).toContain(y.note!);
    expect(y.note!.startsWith('官方經濟欄位')).toBe(true);
    expect(jobById('job-pizza-chef')!.summary).toBeNull();
    expect(jobById('job-vet')!.note).toBeNull();
  });

  it('經濟類型', () => {
    expect(economyKind(jobById('job-vet')!)).toBe('earn');
    expect(economyKind(jobById('job-cheerleader')!)).toBe('spend');
    expect(economyKind(jobById('job-yakiniku')!)).toBe('twd');
    expect(economyKind(jobById('job-pizza-chef')!)).toBe('unknown');
  });

  it('4 歲可參加：24 個確定＋披薩（待確認）＋大學（年齡未知）', () => {
    const ok = JOBS.filter((j) => canJoinNow(eligibility(j, 4)));
    expect(ok.filter((j) => !j.flag)).toHaveLength(24);
    expect(ok.map((j) => j.id)).toEqual(expect.arrayContaining(['job-pizza-chef', 'job-kzu-university']));
    expect(ok).toHaveLength(26);
  });

  it('同編號共用圖釘', () => {
    const p1 = pinsForFloor(1);
    expect(p1.find((p) => p.mapNo === 3)?.jobs).toHaveLength(3);
    expect(p1.find((p) => p.mapNo === 19)?.jobs).toHaveLength(2);
    expect(pinsForFloor(2).find((p) => p.mapNo === 30)?.jobs).toHaveLength(2);
    expect(p1.length + pinsForFloor(2).length).toBe(39);
  });

  it('分類與搜尋', () => {
    expect(CATEGORIES.length).toBeGreaterThan(0);
    expect(JOBS.filter((j) => matchesQuery(j, '#7')).map((j) => j.id)).toEqual(['job-semiconductor']);
    expect(JOBS.filter((j) => matchesQuery(j, '國泰')).map((j) => j.id)).toEqual(['job-health-manager', 'job-surgeon', 'job-paramedic', 'job-nurse']);
    expect(JOBS.filter((j) => matchesQuery(j, 'starlux')).length).toBe(2);
  });
});

import { pinState, isServiceFacility, facilitiesForFloor } from './jobs';

describe('地圖圖釘狀態', () => {
  const pin3 = pinsForFloor(1).find((p) => p.mapNo === 3)!; // 啦啦隊(3歲)、棒球(5)、籃球(5)
  const open4 = (j: { minAge: number | null }) => j.minAge === null || j.minAge <= 4;
  it('4 歲：運動中心可玩（啦啦隊）', () => {
    expect(pinState(pin3, open4, () => false)).toMatchObject({ kind: 'open', doneCount: 0, total: 3 });
  });
  it('完成啦啦隊 → partial；全部完成 → done', () => {
    expect(pinState(pin3, open4, (j) => j.id === 'job-cheerleader').kind).toBe('partial');
    expect(pinState(pin3, open4, () => true).kind).toBe('done');
  });
  it('電競 7 歲 → locked；大學 → pending', () => {
    expect(pinState(pinsForFloor(1).find((p) => p.mapNo === 4)!, open4, () => false).kind).toBe('locked');
    expect(pinState(pinsForFloor(2).find((p) => p.mapNo === 34)!, open4, () => false).pending).toBe(true);
  });
  it('服務設施判斷', () => {
    const f1 = facilitiesForFloor(1);
    expect(f1.filter(isServiceFacility).map((f) => f.id)).toEqual([
      'fac-1f-atm-bank', 'fac-1f-restroom-west', 'fac-1f-clinic-west', 'fac-1f-aed-west', 'fac-1f-restroom-east',
    ]);
  });
});
