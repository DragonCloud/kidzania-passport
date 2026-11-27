-- ============================================================
-- KidZania 職業護照：家庭同步 schema（Supabase）
-- 使用方式：Supabase → SQL Editor → New query → 貼上整段 → Run
-- 測試：npm test（supabase/schema.test.ts 以 PGlite 模擬 Supabase 環境執行本檔）
-- ============================================================
-- ============ 家庭 ============
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null default '我的家庭',
  -- [修正 2026-11-27] 刪除建立者帳號時不連帶刪除整個家庭（與其他成員的紀錄）：改為 set null
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table public.family_invites (
  code text primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days'
);

-- 目前使用者是否為該家庭成員（security definer 避免 RLS 遞迴）
create or replace function public.is_family_member(fid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from family_members where family_id = fid and user_id = auth.uid());
$$;

-- ============ 同步資料 ============
create table public.records (
  family_id uuid not null references public.families(id) on delete cascade,
  tbl text not null check (tbl in ('child','visits','completions','ledger','blobs')),
  id text not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  client_updated_at bigint,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid default auth.uid(),
  primary key (family_id, tbl, id),
  -- [修正 2026-11-27] 單筆內容上限約 200 KB（照片放 Storage，不放這裡）
  constraint records_data_size check (octet_length(data::text) < 200000)
);
create index records_pull_idx on public.records (family_id, updated_at);

-- 伺服器時間與修改者由資料庫決定，客戶端無法偽造
create or replace function public.records_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- [刪除優先] 已軟刪除的紀錄，不會因為其他手機較晚送達的舊編輯而復活。
-- 被擋下時保持 deleted=true 與原內容，但 updated_at 仍會更新（records_touch），
-- 讓送出舊編輯的那支手機下次拉取時收到「已刪除」。
-- 唯一例外：使用者在 App 按「還原」→ 呼叫 restore_record()。
-- trigger 依名稱字母序執行：records_keep_deleted 先於 records_touch。
create or replace function public.records_keep_deleted()
returns trigger language plpgsql as $$
begin
  if old.deleted and not new.deleted
     and coalesce(current_setting('kidzania.allow_restore', true), '') <> 'on' then
    new.deleted := true;
    new.data := old.data;
    new.client_updated_at := old.client_updated_at;
  end if;
  return new;
end $$;
create trigger records_keep_deleted before update on public.records
  for each row execute function public.records_keep_deleted();

-- ============ RLS ============
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_invites enable row level security;
alter table public.records enable row level security;

create policy families_select on public.families for select to authenticated using (public.is_family_member(id));
create policy families_update on public.families for update to authenticated
  using (public.is_family_member(id)) with check (public.is_family_member(id));

create policy members_select on public.family_members for select to authenticated using (public.is_family_member(family_id));
create policy members_leave on public.family_members for delete to authenticated using (user_id = auth.uid());

create policy invites_select on public.family_invites for select to authenticated using (public.is_family_member(family_id));
create policy invites_delete on public.family_invites for delete to authenticated using (public.is_family_member(family_id));

create policy records_select on public.records for select to authenticated using (public.is_family_member(family_id));
create policy records_insert on public.records for insert to authenticated with check (public.is_family_member(family_id));
create policy records_update on public.records for update to authenticated
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
-- 不開 delete：一律軟刪除（deleted = true）

-- [修正] 明確授權：Supabase 自 2026-05-30 起新專案（10-30 起所有專案）
-- 不再自動把 public 的新表／函式開放給 anon／authenticated，沒有這段 App 會得到 permission denied
revoke all on public.families, public.family_members, public.family_invites, public.records from anon;
grant select on public.families to authenticated;
-- [修正 2026-11-27] 成員只能改家庭名稱，不能改 owner_id
grant update (name) on public.families to authenticated;
grant select, delete on public.family_members to authenticated;
grant select, delete on public.family_invites to authenticated;
grant select, insert, update on public.records to authenticated;
revoke all on function public.is_family_member(uuid) from public, anon;
grant execute on function public.is_family_member(uuid) to authenticated;

-- ============ RPC ============
create or replace function public.create_family(p_name text default '我的家庭')
returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from family_members where user_id = auth.uid()) then
    raise exception 'already in a family';
  end if;
  insert into families (name, owner_id) values (coalesce(nullif(p_name,''),'我的家庭'), auth.uid()) returning id into fid;
  insert into family_members (family_id, user_id, email) values (fid, auth.uid(), auth.jwt()->>'email');
  return fid;
end $$;

create or replace function public.create_invite()
returns table (invite_code text, invite_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare fid uuid; c text; exp timestamptz; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; i int;
begin
  select family_id into fid from family_members where user_id = auth.uid();
  if fid is null then raise exception 'not in a family'; end if;
  -- [修正] 用 pgcrypto 的密碼學亂數（random() 可被預測）；32 個字元 × 10 碼 ≈ 50 bits
  b := extensions.gen_random_bytes(10);
  c := '';
  for i in 0..9 loop
    c := c || substr(alphabet, 1 + (get_byte(b, i) % 32), 1);
  end loop;
  delete from family_invites where family_id = fid and family_invites.expires_at < now();
  -- [修正] 回傳實際寫入的到期時間
  insert into family_invites (code, family_id, created_by) values (c, fid, auth.uid())
    returning family_invites.expires_at into exp;
  return query select c, exp;
end $$;

create or replace function public.join_family(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from family_members where user_id = auth.uid()) then
    raise exception 'already in a family';
  end if;
  select family_id into fid from family_invites
    where code = upper(trim(p_code)) and expires_at > now();
  if fid is null then raise exception 'invalid or expired code'; end if;
  insert into family_members (family_id, user_id, email) values (fid, auth.uid(), auth.jwt()->>'email');
  delete from family_invites where code = upper(trim(p_code));
  return fid;
end $$;

-- [刪除優先] 明確還原一筆已刪除的紀錄（App 的「還原」按鈕）。
-- security invoker：仍受 records 的 RLS 限制；只在本次交易內允許 deleted 由 true 改回 false。
create or replace function public.restore_record(p_tbl text, p_id text, p_data jsonb default null)
returns void language plpgsql security invoker set search_path = public as $$
declare fid uuid; n int;
begin
  select family_id into fid from family_members where user_id = auth.uid();
  if fid is null then raise exception 'not in a family'; end if;
  perform set_config('kidzania.allow_restore', 'on', true);
  update records set deleted = false, data = coalesce(p_data, data)
    where family_id = fid and tbl = p_tbl and id = p_id;
  get diagnostics n = row_count;
  perform set_config('kidzania.allow_restore', 'off', true);
  if n = 0 then raise exception 'record not found'; end if;
end $$;

-- 保活：GitHub Actions 每天用 anon key 呼叫一次
-- [修正 2026-11-27] 回傳常數，不透露任何資料（仍會對資料庫發出查詢，算作活動）
create or replace function public.keepalive()
returns integer language sql stable as $$
  select 1;
$$;

revoke all on function public.create_family(text), public.create_invite(), public.join_family(text), public.restore_record(text, text, jsonb) from public, anon;
grant execute on function public.create_family(text), public.create_invite(), public.join_family(text), public.restore_record(text, text, jsonb) to authenticated;
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

-- Realtime（即時推送；RLS 同樣生效）
alter publication supabase_realtime add table public.records;

-- ============ Storage：私有 photos bucket ============
-- [修正] 以文字比對資料夾名稱，避免 ::uuid 轉型在非 uuid 路徑時直接報錯
create or replace function public.is_family_folder(folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from family_members where family_id::text = folder and user_id = auth.uid());
$$;
revoke all on function public.is_family_folder(text) from public, anon;
grant execute on function public.is_family_folder(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy photos_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_family_folder((storage.foldername(name))[1]));
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_family_folder((storage.foldername(name))[1]));
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.is_family_folder((storage.foldername(name))[1]));
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_family_folder((storage.foldername(name))[1]));
