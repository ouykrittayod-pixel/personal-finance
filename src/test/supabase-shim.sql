-- TEST ONLY. The parts of Supabase's platform schema that the migrations rely
-- on, so they can run unchanged in PGlite (real PostgreSQL, in-process):
-- roles anon / authenticated, auth.users, auth.uid(), storage.buckets,
-- storage.objects (RLS on, as in Supabase), storage.foldername().
-- auth.uid() reads the JWT subject exactly the way Supabase's does.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key, email text unique);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner_id text default (auth.uid())::text,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
grant usage on schema storage to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;

-- Supabase grants table privileges in public to these roles by default; the migration must revoke what it doesn't want.
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
