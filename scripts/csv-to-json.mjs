#!/usr/bin/env node
/**
 * data-src/*.csv  →  src/data/jobs.json、src/data/facilities.json
 *
 *   npm run data         重新產生 JSON
 *   npm run data:check   只比對：CSV 轉出結果與已提交的 JSON 不同就失敗（build 前會跑）
 *
 * 原則：
 * - 空白欄位一律轉成 null，不補任何數值。
 * - 文字欄位只去掉頭尾空白，不改內容。
 * - 唯一的資料修正寫在 CORRECTIONS，且會先核對原值，CSV 若已改過就停下來提醒。
 * - description 原文完整保留；另拆出 summary（簡介）與 note（內部備註）給詳情頁使用。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JOBS_CSV = join(ROOT, 'data-src/kidzania_taipei_jobs_v2.csv');
const FAC_CSV = join(ROOT, 'data-src/facilities_v2.csv');
const JOBS_JSON = join(ROOT, 'src/data/jobs.json');
const FAC_JSON = join(ROOT, 'src/data/facilities.json');
const CHECK = process.argv.includes('--check');

/** Eason 確認過的資料修正（2026-11-27） */
const CORRECTIONS = {
  'job-paramedic': {
    sponsor: {
      expect: 'Z 國泰健康園區 Cathay Health Park 急診室',
      value: '國泰健康園區 Cathay Health Park 急診室',
    },
  },
};

/**
 * description 內混有內部備註的職業：從標記字串開始算備註。
 * 沒有官方頁（official_url 空白）的職業，整段 description 都視為備註。
 */
const NOTE_MARKERS = {
  'job-yakiniku': '官方經濟欄位',
};

// ── 最小 RFC 4180 CSV 解析（支援引號、引號內逗號與換行） ──
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

function readTable(path) {
  const [header, ...rows] = parseCsv(readFileSync(path, 'utf8'));
  return rows.map((r, i) => {
    if (r.length !== header.length) {
      throw new Error(`${path} 第 ${i + 2} 行欄位數 ${r.length}，應為 ${header.length}`);
    }
    return Object.fromEntries(header.map((h, j) => [h.trim(), r[j]]));
  });
}

const errors = [];
const fail = (id, msg) => errors.push(`${id}: ${msg}`);

const str = (v) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};
const num = (id, col, v) => {
  const t = str(v);
  if (t === null) return null;
  const n = Number(t.replace(/^\+/, ''));
  if (!Number.isFinite(n)) { fail(id, `${col} 不是數字：「${t}」`); return null; }
  return n;
};
const coord = (id, col, v) => {
  const n = num(id, col, v);
  if (n !== null && (n < 0 || n > 1)) fail(id, `${col} 超出 0–1：${n}`);
  return n;
};
const floor = (id, v) => {
  const n = num(id, 'floor', v);
  if (n !== null && n !== 1 && n !== 2) fail(id, `floor 只能是 1 或 2：${n}`);
  return n;
};

function applyCorrection(id, col, raw) {
  const c = CORRECTIONS[id]?.[col];
  if (!c) return raw;
  if (raw !== c.expect) {
    fail(id, `預期 ${col} 原值為「${c.expect}」才修正，但 CSV 是「${raw}」。請檢查 CORRECTIONS。`);
    return raw;
  }
  return c.value;
}

function splitDescription(id, description, officialUrl) {
  if (description === null) return { summary: null, note: null };
  if (officialUrl === null) return { summary: null, note: description };
  const marker = NOTE_MARKERS[id];
  if (!marker) return { summary: description, note: null };
  const at = description.indexOf(marker);
  if (at < 0) { fail(id, `description 找不到備註標記「${marker}」`); return { summary: description, note: null }; }
  return { summary: description.slice(0, at).trim() || null, note: description.slice(at).trim() };
}

// ── 職業 ──
const jobs = readTable(JOBS_CSV).map((r) => {
  const id = str(r.id);
  if (!id) throw new Error('有職業缺少 id');
  const heightReq = str(r.height_req);
  let heightCm = null;
  if (heightReq) {
    const m = heightReq.match(/^(\d+(?:\.\d+)?)\s*cm$/i);
    if (m) heightCm = Number(m[1]);
    else fail(id, `height_req 無法解析：「${heightReq}」`);
  }
  const description = str(r.description);
  const officialUrl = str(r.official_url);
  const { summary, note } = splitDescription(id, description, officialUrl);
  const flag = str(r.flag);
  if (flag !== null && flag !== '待確認') fail(id, `flag 只能是空白或「待確認」：${flag}`);
  const confidence = str(r.confidence);
  if (!['high', 'medium', 'low'].includes(confidence)) fail(id, `confidence 不合法：${confidence}`);

  const job = {
    id,
    nameZh: str(r.name_zh),
    venueZh: str(r.venue_zh),
    sponsor: applyCorrection(id, 'sponsor', str(r.sponsor)),
    mapNo: num(id, 'map_no', r.map_no),
    floor: floor(id, r.floor),
    x: coord(id, 'x', r.x),
    y: coord(id, 'y', r.y),
    mapCategory: str(r.map_category),
    minAge: num(id, 'min_age', r.min_age),
    maxAge: num(id, 'max_age', r.max_age),
    heightReq,
    heightCm,
    kidzoDelta: num(id, 'kidzo', r['kidzo (+earn/-pay)']),
    ntdFee: num(id, 'ntd_fee', r.ntd_fee),
    durationMin: num(id, 'duration_min', r.duration_min),
    accompanyRule: str(r.accompany_rule),
    description,
    summary,
    note,
    officialUrl,
    sourceUrls: (str(r.source_url) ?? '').split(/\s+/).filter(Boolean),
    flag,
    confidence,
  };
  for (const k of ['nameZh', 'venueZh', 'mapCategory']) if (!job[k]) fail(id, `${k} 不可空白`);
  return job;
});

// ── 設施 ──
const facilities = readTable(FAC_CSV).map((r) => {
  const id = str(r.id);
  if (!id) throw new Error('有設施缺少 id');
  const f = {
    id,
    letter: str(r.letter),
    nameZh: str(r.name_zh),
    floor: floor(id, r.floor),
    x: coord(id, 'x', r.x),
    y: coord(id, 'y', r.y),
    facilityType: str(r.facility_type),
    sponsor: str(r.sponsor),
    notes: str(r.notes),
  };
  for (const k of ['nameZh', 'floor', 'x', 'y', 'facilityType']) if (f[k] === null) fail(id, `${k} 不可空白`);
  return f;
});

for (const [label, list] of [['職業', jobs], ['設施', facilities]]) {
  const seen = new Set();
  for (const { id } of list) {
    if (seen.has(id)) fail(id, `${label} id 重複`);
    seen.add(id);
  }
}
for (const id of Object.keys({ ...CORRECTIONS, ...NOTE_MARKERS })) {
  if (!jobs.some((j) => j.id === id)) fail(id, '修正／備註設定指到不存在的職業');
}

if (errors.length) {
  console.error(`✗ 資料檢查失敗（${errors.length} 項）：\n  ` + errors.join('\n  '));
  process.exit(1);
}

const out = (v) => JSON.stringify(v, null, 2) + '\n';
const jobsOut = out(jobs);
const facOut = out(facilities);

const stats = [
  `職業 ${jobs.length} 筆（待確認 ${jobs.filter((j) => j.flag).length}，含備註 ${jobs.filter((j) => j.note).length}）`,
  `設施 ${facilities.length} 筆`,
];

if (CHECK) {
  const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
  const stale = [[JOBS_JSON, jobsOut], [FAC_JSON, facOut]].filter(([p, s]) => read(p) !== s).map(([p]) => p);
  if (stale.length) {
    console.error(`✗ JSON 與 CSV 不一致，請執行 npm run data：\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`✓ 資料一致：${stats.join('；')}`);
} else {
  writeFileSync(JOBS_JSON, jobsOut);
  writeFileSync(FAC_JSON, facOut);
  console.log(`✓ 已產生 src/data/jobs.json、facilities.json：${stats.join('；')}`);
}
