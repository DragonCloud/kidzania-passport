import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createSupabaseLikeDb, USERS } from './pgSupabase';

const { parentA: A, parentB: B, stranger: S } = USERS;

let db: PGlite;
let familyId: string;

/** 模擬 App 的 upsert（supabase-js upsert onConflict: family_id,tbl,id） */
const UPSERT = `insert into public.records (family_id, tbl, id, data, deleted, client_updated_at)
  values ($1, $2, $3, $4::jsonb, $5, $6)
  on conflict (family_id, tbl, id) do update
    set data = excluded.data, deleted = excluded.deleted, client_updated_at = excluded.client_updated_at`;

interface RecordRow {
  data: { note?: string };
  deleted: boolean;
  updated_at: string;
  updated_by: string;
}
const readRecord = async (id: string) =>
  (await asUser<RecordRow>(db, A, `select data, deleted, updated_at::text, updated_by from public.records where id = $1`, [id]))[0]!;

beforeAll(async () => {
  db = await createSupabaseLikeDb();
}, 60_000);

describe('schema.sql：在不自動授權的新專案上執行', () => {
  it('整段 SQL 可執行，家庭建立、邀請、加入', async () => {
    familyId = (await asUser<{ id: string }>(db, A, `select public.create_family('測試家庭') as id`))[0]!.id;
    expect(familyId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(asUser(db, A, `select public.create_family()`)).rejects.toThrow('already in a family');

    const [inv] = await asUser<{ invite_code: string; invite_expires_at: string }>(db, A, `select * from public.create_invite()`);
    expect(inv!.invite_code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
    const days = (new Date(inv!.invite_expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    await expect(asUser(db, B, `select public.join_family('XXXXXXXXXX')`)).rejects.toThrow('invalid or expired code');
    await asUser(db, B, `select public.join_family($1)`, [` ${inv!.invite_code.toLowerCase()} `]);
    await expect(asUser(db, S, `select public.join_family($1)`, [inv!.invite_code])).rejects.toThrow('invalid or expired code');
    await expect(asUser(db, null, `select public.create_invite()`)).rejects.toThrow();
  });

  it('records：家人可讀寫、陌生人看不到也寫不進、不能硬刪除', async () => {
    await asUser(db, A, UPSERT, [familyId, 'completions', 'c1', '{"note":"A"}', false, 1]);
    const rows = await asUser<{ id: string; updated_by: string }>(db, B, `select id, updated_by from public.records`);
    expect(rows).toEqual([{ id: 'c1', updated_by: A.id }]);
    expect(await asUser(db, S, `select * from public.records`)).toEqual([]);
    await expect(asUser(db, S, UPSERT, [familyId, 'completions', 'x', '{}', false, 1])).rejects.toThrow();
    await expect(asUser(db, A, UPSERT, [familyId, 'settings', 'x', '{}', false, 1])).rejects.toThrow();
    await expect(asUser(db, A, `delete from public.records where id = 'c1'`)).rejects.toThrow('permission denied');
    await expect(asUser(db, null, `select * from public.records`)).rejects.toThrow('permission denied');
  });

  it('updated_by 由 trigger 決定，客戶端無法偽造', async () => {
    await asUser(
      db,
      B,
      `insert into public.records (family_id, tbl, id, data, updated_by) values ($1, 'completions', 'c1', '{"note":"B"}', $2)
       on conflict (family_id, tbl, id) do update set data = excluded.data, updated_by = excluded.updated_by`,
      [familyId, A.id],
    );
    expect((await readRecord('c1')).updated_by).toBe(B.id);
  });
});

describe('刪除優先', () => {
  it('已軟刪除的紀錄，不會被另一支手機較晚送達的舊編輯復活', async () => {
    await asUser(db, A, UPSERT, [familyId, 'completions', 'c2', '{"note":"原本"}', false, 100]);
    // A 刪除
    await asUser(db, A, UPSERT, [familyId, 'completions', 'c2', '{"note":"原本"}', true, 200]);
    const afterDelete = await readRecord('c2');
    expect(afterDelete.deleted).toBe(true);

    // B 離線時改了備註，稍後才上線送出（deleted=false）
    await asUser(db, B, UPSERT, [familyId, 'completions', 'c2', '{"note":"B 離線時的修改"}', false, 150]);
    const afterStale = await readRecord('c2');
    expect(afterStale.deleted).toBe(true);
    expect(afterStale.data.note).toBe('原本');
    // updated_at 仍往前推，B 下次增量拉取會收到「已刪除」
    expect(new Date(afterStale.updated_at).getTime()).toBeGreaterThan(new Date(afterDelete.updated_at).getTime());
    const pulledByB = await asUser<{ id: string; deleted: boolean }>(
      db,
      B,
      `select id, deleted from public.records where family_id = $1 and updated_at > $2::timestamptz`,
      [familyId, afterDelete.updated_at],
    );
    expect(pulledByB).toEqual([{ id: 'c2', deleted: true }]);
  });

  it('使用者按「還原」（restore_record）才能復活，之後可正常編輯；再刪除後同樣受保護', async () => {
    await asUser(db, B, `select public.restore_record('completions', 'c2', '{"note":"還原後"}'::jsonb)`);
    let r = await readRecord('c2');
    expect(r.deleted).toBe(false);
    expect(r.data.note).toBe('還原後');
    expect(r.updated_by).toBe(B.id);

    await asUser(db, A, UPSERT, [familyId, 'completions', 'c2', '{"note":"還原後再修改"}', false, 300]);
    expect((await readRecord('c2')).data.note).toBe('還原後再修改');

    await asUser(db, A, UPSERT, [familyId, 'completions', 'c2', '{"note":"還原後再修改"}', true, 400]);
    await asUser(db, B, UPSERT, [familyId, 'completions', 'c2', '{"note":"又一個舊編輯"}', false, 350]);
    r = await readRecord('c2');
    expect(r.deleted).toBe(true);
    expect(r.data.note).toBe('還原後再修改');
  });

  it('還原不帶內容時保留原內容；restore 後的允許旗標不會外溢到同一連線的下一個請求', async () => {
    await asUser(db, A, `select public.restore_record('completions', 'c2')`);
    expect((await readRecord('c2')).data.note).toBe('還原後再修改');
    await asUser(db, A, UPSERT, [familyId, 'completions', 'c2', '{"note":"x"}', true, 500]);
    await asUser(db, A, UPSERT, [familyId, 'completions', 'c2', '{"note":"y"}', false, 600]);
    expect((await readRecord('c2')).deleted).toBe(true);
  });

  it('陌生人或不存在的紀錄不能還原', async () => {
    await expect(asUser(db, S, `select public.restore_record('completions', 'c2')`)).rejects.toThrow('not in a family');
    await expect(asUser(db, A, `select public.restore_record('completions', 'nope')`)).rejects.toThrow('record not found');
    await expect(asUser(db, null, `select public.restore_record('completions', 'c2')`)).rejects.toThrow();
  });
});

describe('Storage photos policy', () => {
  it('家人可存取自家資料夾；陌生人與非 uuid 路徑被擋', async () => {
    await asUser(db, A, `insert into storage.objects (bucket_id, name) values ('photos', $1)`, [`${familyId}/b1.jpg`]);
    expect(await asUser(db, B, `select name from storage.objects`)).toEqual([{ name: `${familyId}/b1.jpg` }]);
    expect(await asUser(db, S, `select name from storage.objects`)).toEqual([]);
    await expect(asUser(db, S, `insert into storage.objects (bucket_id, name) values ('photos', $1)`, [`${familyId}/x.jpg`])).rejects.toThrow(
      'row-level security',
    );
    await expect(asUser(db, A, `insert into storage.objects (bucket_id, name) values ('photos', 'not-a-uuid/x.jpg')`)).rejects.toThrow(
      'row-level security',
    );
  });
});

describe('2026-11-27 schema 修正', () => {
  it('keepalive() 回傳常數，anon 可呼叫但看不到任何數量', async () => {
    expect(await asUser(db, null, `select public.keepalive() as n`)).toEqual([{ n: 1 }]);
    await asUser(db, S, `select public.create_family('陌生人的家')`);
    expect(await asUser(db, null, `select public.keepalive() as n`)).toEqual([{ n: 1 }]);
  });

  it('成員只能改家庭名稱，不能改 owner_id', async () => {
    await asUser(db, B, `update public.families set name = '改名後' where id = $1`, [familyId]);
    expect((await asUser<{ name: string }>(db, A, `select name from public.families where id = $1`, [familyId]))[0]!.name).toBe('改名後');
    await expect(asUser(db, B, `update public.families set owner_id = $1 where id = $2`, [B.id, familyId])).rejects.toThrow('permission denied');
  });

  it('records.data 超過約 200 KB 被拒', async () => {
    const big = JSON.stringify({ id: 'big', blob: 'x'.repeat(200_000) });
    await expect(asUser(db, A, UPSERT, [familyId, 'completions', 'big', big, false, 1])).rejects.toThrow('records_data_size');
    const ok = JSON.stringify({ id: 'ok', note: 'x'.repeat(10_000) });
    await asUser(db, A, UPSERT, [familyId, 'completions', 'ok', ok, false, 1]);
  });

  it('刪除建立者帳號不會刪掉家庭與其他成員的紀錄（owner 改為 null）', async () => {
    await asUser(db, B, UPSERT, [familyId, 'completions', 'from-b', '{"id":"from-b"}', false, 1]);
    const before = (await asUser(db, B, `select id from public.records`)).length;
    await db.query('delete from auth.users where id = $1', [A.id]); // 管理者在後台刪除 A 的帳號
    const fam = await asUser<{ owner_id: string | null }>(db, B, `select owner_id from public.families where id = $1`, [familyId]);
    expect(fam).toEqual([{ owner_id: null }]);
    expect((await asUser(db, B, `select id from public.records`)).length).toBe(before);
    expect(await asUser<{ email: string }>(db, B, `select email from public.family_members where family_id = $1`, [familyId])).toEqual([{ email: B.email }]);
  });
});
