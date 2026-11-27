/**
 * 測試用：在 PGlite（WebAssembly Postgres）模擬 Supabase 的 auth／storage／realtime 環境，
 * 並以「2026-05-30 後的新專案」設定執行（public 新物件不自動授權給 anon／authenticated）。
 * 只供 schema.test.ts 使用，不會打包進網站。
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));

export interface TestUser {
  id: string;
  email: string;
}

export const USERS = {
  parentA: { id: '11111111-1111-4111-8111-111111111111', email: 'parent-a@example.com' },
  parentB: { id: '22222222-2222-4222-8222-222222222222', email: 'parent-b@example.com' },
  stranger: { id: '33333333-3333-4333-8333-333333333333', email: 'stranger@example.com' },
} satisfies Record<string, TestUser>;

export async function createSupabaseLikeDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth; create schema storage; create schema extensions;
    create extension pgcrypto schema extensions;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    create publication supabase_realtime;
    grant usage on schema public, auth, storage, extensions to anon, authenticated;
    grant execute on all functions in schema auth to anon, authenticated;
    grant all on storage.objects to authenticated;
    -- 新專案行為：public 的新函式不自動開放執行
    alter default privileges in schema public revoke execute on functions from public;
  `);
  for (const u of Object.values(USERS)) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
  }
  await db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

/** 以指定使用者（或 anon）身分執行一段 SQL，模擬 PostgREST 帶 JWT 的請求 */
export async function asUser<T = Record<string, unknown>>(
  db: PGlite,
  user: TestUser | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const claims = user ? JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' }) : '';
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [
    user?.id ?? '',
    claims,
  ]);
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
