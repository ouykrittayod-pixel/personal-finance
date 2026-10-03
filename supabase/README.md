# Supabase (Phase 19 — encrypted storage foundation)

The app runs without any of this. Configure it only to test the encrypted-cloud foundation with **synthetic** data.

## Setup (done by the project owner, not by the app)

1. Create a Supabase project in the Supabase dashboard (the app never creates accounts or projects).
2. Apply the migrations in `migrations/` in file-name order. Either paste them into **SQL Editor**, or use `supabase link` + `supabase db push` with the Supabase CLI. They create:
   - `public.sync_records` (ciphertext only) with RLS enabled and forced, one owner-only policy per operation, no access for `anon`, a server-owned revision/timestamp trigger, and the **Phase 19 guard** that only `synthetic_*` record types are accepted;
   - the private Storage bucket `encrypted-attachments` and owner-folder policies.
3. **Authentication → Providers → Email:** enabled. Leave all other providers off (no Google).
4. **Authentication → URL Configuration:** Site URL and Redirect URLs = the app origins, e.g. `http://localhost:5173/` for development, and later the GitHub Pages URL.
5. Optional, for one-time codes instead of links: in **Authentication → Email Templates → Magic Link**, include `{{ .Token }}`. The app accepts both the code and the link.
6. Copy `.env.example` to `.env.local` and fill in the **Project URL** and the **anon / publishable** key.
   - **Never** use the service_role / secret key, the database password or the JWT secret in the app. The build refuses them.

Then run `npm run dev`, open `#/dev/cloud`, sign in, create an encryption key, and run the synthetic round trip. It uploads 43 synthetic encrypted records, downloads and decrypts them, compares them, and deletes them.

## Tests

`src/features/cloud/rls.test.ts` runs these exact migration files in PGlite (PostgreSQL in WASM) on top of a small platform shim (`src/test/supabase-shim.sql`: roles, `auth.uid()`, storage tables). It checks user isolation for select, insert, update and delete, anon access, server-owned fields, constraints and storage policies. This is not a substitute for testing against the hosted project, but it tests the real SQL and the real RLS engine.
