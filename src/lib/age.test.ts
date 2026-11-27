import { describe, expect, it } from 'vitest';
import { ageParts, canJoinNow, eligibility, formatAge, fullYears, isValidBirthday } from './age';

describe('ageParts', () => {
  it('範例：2020-03-15 → 2024-10-20 為 4 歲 7 個月', () => {
    expect(ageParts('2020-03-15', '2024-10-20')).toEqual({ years: 4, months: 7 });
    expect(formatAge(ageParts('2020-03-15', '2024-10-20'))).toBe('4 歲 7 個月');
  });
  it('生日前一天未滿、當天滿歲', () => {
    expect(fullYears('2020-03-15', '2025-03-14')).toBe(4);
    expect(fullYears('2020-03-15', '2025-03-15')).toBe(5);
  });
  it('2/29 生日在平年 3/1 才滿歲', () => {
    expect(fullYears('2020-02-29', '2025-02-28')).toBe(4);
    expect(fullYears('2020-02-29', '2025-03-01')).toBe(5);
  });
  it('未來或錯誤日期回 null', () => {
    expect(ageParts('2030-01-01', '2026-11-27')).toBeNull();
    expect(ageParts('2022-02-30', '2026-11-27')).toBeNull();
    expect(isValidBirthday('2022-13-01', '2026-11-27')).toBe(false);
  });
});

describe('eligibility', () => {
  it('依 minAge 判斷', () => {
    expect(eligibility({ minAge: 3, maxAge: null }, 4)).toBe('eligible');
    expect(eligibility({ minAge: 5, maxAge: null }, 4)).toBe('locked');
    expect(eligibility({ minAge: 3, maxAge: 4 }, 5)).toBe('tooOld');
  });
  it('年齡空白（例如大學 KZU）列為 unknown 且算可參加', () => {
    const e = eligibility({ minAge: null, maxAge: null }, 4);
    expect(e).toBe('unknown');
    expect(canJoinNow(e)).toBe(true);
  });
  it('未設定生日', () => {
    expect(eligibility({ minAge: 3, maxAge: null }, null)).toBe('noProfile');
  });
});
