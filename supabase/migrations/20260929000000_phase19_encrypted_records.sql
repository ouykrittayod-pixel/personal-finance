-- Phase 19 — encrypted record storage foundation.
--
-- The server stores CIPHERTEXT ONLY. There are no columns for amounts,
-- categories, accounts, dates, notes, balances, names or file contents; those
-- exist only inside `ciphertext` (AES-256-GCM, encrypted on the device with a
-- key the server never receives).
--
-- Routing metadata kept (minimum): owner, record type, record id, key id,
-- envelope version, IV, server revision and server timestamps. This reveals
-- how many records of each type a user has and when they changed — documented
-- in docs/security/phase-19-security.md.
--
-- Isolation is enforced by PostgreSQL Row Level Security: a user can only see
-- or change rows where user_id = auth.uid(). The anon role has no access.
--
-- PHASE 19 GUARD: record_type must start with "synthetic_". Real finance
-- records cannot be stored until a later migration lifts this deliberately.

create table public.sync_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  record_type text not null,
  record_id uuid not null,
  key_id uuid not null,
  envelope_version smallint not null,
  iv text not null,
  ciphertext text not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, record_type, record_id),
  constraint sync_records_record_type_synthetic_only check (record_type ~ '^synthetic_[a-z_]{1,40}$'),
  constraint sync_records_envelope_version check (envelope_version = 1),
  -- base64url of exactly 12 bytes
  constraint sync_records_iv check (iv ~ '^[A-Za-z0-9_-]{16}$'),
  -- base64url; at least the 16-byte GCM tag; at most 1 MiB of text
  constraint sync_records_ciphertext check (ciphertext ~ '^[A-Za-z0-9_-]+$' and length(ciphertext) between 22 and 1048576),
  constraint sync_records_revision check (revision >= 1)
);

comment on table public.sync_records is 'End-to-end encrypted records (ciphertext only). Phase 19: synthetic test records only.';

-- Server-owned bookkeeping: revision and timestamps cannot be set by clients;
-- a row can never be moved to another owner, type or id.
create function public.sync_records_stamp() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := now();
    new.updated_at := now();
  else
    if new.user_id is distinct from old.user_id or new.record_type is distinct from old.record_type or new.record_id is distinct from old.record_id then
      raise exception 'sync_records: owner, type and id are immutable' using errcode = '42501';
    end if;
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger sync_records_stamp
before insert or update on public.sync_records
for each row execute function public.sync_records_stamp();

-- Privileges: nothing for anon; CRUD for signed-in users, filtered by RLS.
revoke all on table public.sync_records from public;
revoke all on table public.sync_records from anon;
grant select, insert, update, delete on table public.sync_records to authenticated;

alter table public.sync_records enable row level security;
alter table public.sync_records force row level security;

create policy sync_records_select_own on public.sync_records
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy sync_records_insert_own on public.sync_records
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy sync_records_update_own on public.sync_records
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy sync_records_delete_own on public.sync_records
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Private Storage for future ENCRYPTED attachments (nothing is uploaded in
-- Phase 19). Objects live under "<user id>/…"; only application/octet-stream
-- (ciphertext) is accepted; the bucket is private (no public URLs).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('encrypted-attachments', 'encrypted-attachments', false, 10485760, array['application/octet-stream'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy encrypted_attachments_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'encrypted-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy encrypted_attachments_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'encrypted-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy encrypted_attachments_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'encrypted-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'encrypted-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy encrypted_attachments_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'encrypted-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
