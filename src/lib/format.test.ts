import { describe, expect, it } from 'vitest';
import { economyLabel, formatKidzos, fromLocalInput, localDateISO, signed, stampDate, toLocalInput } from './format';

describe('format', () => {
  it('正負號與 kidZos', () => {
    expect(signed(10)).toBe('+10');
    expect(signed(-5)).toBe('−5');
    expect(formatKidzos(-5)).toBe('−5 kidZos');
    expect(economyLabel({ kidzoDelta: null, ntdFee: 199 })).toBe('自費 NT$199');
    expect(economyLabel({ kidzoDelta: null, ntdFee: null })).toBeNull();
  });
  it('datetime-local 來回轉換', () => {
    const ms = new Date(2026, 10, 27, 14, 5).getTime();
    expect(toLocalInput(ms)).toBe('2026-11-27T14:05');
    expect(fromLocalInput('2026-11-27T14:05')).toBe(ms);
    expect(fromLocalInput('bad')).toBeNull();
    expect(localDateISO(ms)).toBe('2026-11-27');
    expect(stampDate(ms)).toBe('2026.11.27');
  });
});

import { formatNtd } from './format';
import { sumTwdSpent } from './ledger';

describe('新臺幣 -0', () => {
  it('沒有自費時是 0 而不是 -0', () => {
    expect(Object.is(sumTwdSpent([]), 0)).toBe(true);
    expect(Object.is(sumTwdSpent([{ id: 'g', at: 0, type: 'grant', amount: 50, currency: 'kidZos' }]), 0)).toBe(true);
    expect(sumTwdSpent([{ id: 't', at: 0, type: 'twd_fee', amount: -199, currency: 'TWD' }])).toBe(199);
    expect(formatNtd(-0)).toBe('NT$0');
  });
});
