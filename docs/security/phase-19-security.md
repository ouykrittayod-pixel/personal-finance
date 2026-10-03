# Phase 19 — security foundation for encrypted cloud storage

Status: **foundation only.** The app remains local-first and works fully without an account. Phase 19 adds optional sign-in, device-side encryption, an encrypted-record table with Row Level Security, and a private bucket for future encrypted attachments. **No finance data is synchronized or uploaded.** Only synthetic `synthetic_*` records can be stored, and this is enforced in the client *and* by a database constraint.

This document describes what each party can and cannot see. It does not claim the system is "100% secure": it states what the design protects against, and what it does not.

## Components

| Piece | Where | Notes |
| --- | --- | --- |
| Local finance database | IndexedDB (Dexie v3), this browser | Plaintext, as before. Never uploaded in Phase 19. |
| Sign-in | Supabase Auth, email one-time code / magic link (PKCE) | Optional. No passwords, no Google. |
| Session tokens | `localStorage["pf-cloud-auth"]` (supabase-js) | Access token (short-lived JWT) + refresh token. Not in IndexedDB, so never in backups. |
| Data encryption key (DEK) | Random AES-256-GCM key, made by Web Crypto on the device | In memory only, as a **non-extractable** `CryptoKey`, while unlocked. |
| Wrapped DEK | IndexedDB table `keyring` (this device only) | The DEK encrypted with AES-256-GCM under a key derived from the **encryption passphrase** (PBKDF2-SHA-256, 600,000 iterations, random 16-byte salt). |
| Encryption passphrase | The user's memory | Never stored, never sent, never derived from sign-in. At least 12 characters. |
| Encrypted records | Supabase Postgres `public.sync_records` | Envelope = key id + 12-byte IV + ciphertext (AES-256-GCM, 128-bit tag). |
| Attachment bucket | Supabase Storage `encrypted-attachments` | Private; `application/octet-stream` only; per-user folders. Unused in Phase 19. |

### Envelope format (version 1)

```json
{ "v": 1, "alg": "A256GCM", "kid": "<key id>", "iv": "<base64url, 12 bytes>", "ct": "<base64url, ciphertext + 16-byte tag>" }
```

- Plaintext = the record as JSON (UTF-8).
- A new random 96-bit IV for every encryption, never reused. Random IVs are safe well beyond this app's volume (the NIST limit for one key is 2³² encryptions).
- The additional authenticated data (not stored; recomputed on decrypt) is `["pf-record", v, alg, kid, userId, recordType, recordId]`. A ciphertext copied to another row, user, type or key **fails** to decrypt.
- Any change to `ct`, `iv` or `kid`, a wrong key, or an unknown version fails closed with a generic error.
- Stored in Postgres as columns `key_id`, `envelope_version`, `iv`, `ciphertext` (base64url).

### What the server table holds

`user_id, record_type, record_id, key_id, envelope_version, iv, ciphertext, revision, created_at, updated_at`

There are no columns for amounts, categories, accounts, dates, notes, balances, income, budgets, counterparties or file contents. `revision` and the timestamps are set by a trigger, not by clients. Owner, type and id are immutable.

## 1. What GitHub Pages can see

The static files only: HTML, JS, CSS, icons. Every build contains the **public** Supabase URL and anon/publishable key, if configured; these are public by design, and RLS is what protects data. Pages never receives finance data, tokens, keys or passphrases, because the app talks to Supabase directly from the browser. Pages (or anyone able to change the deployed files) *can* change the code the browser runs. See the limits section.

## 2. What Supabase can see

- **Account data:** email address, sign-in times, IP addresses and user agents of auth requests (standard Supabase Auth logs).
- **Per stored record:** owner id, record type (for example `synthetic_transaction`), record id, key id, envelope version, IV, ciphertext length and change times/revisions.
- **Derived metadata:** how many records of each type a user has, when they change, and the approximate size of each record.
- **Not visible:** any plaintext finance value, the DEK, the wrapped DEK (never uploaded in Phase 19), the passphrase, or the device id.

## 3. An attacker with database read access (e.g. a leaked dump)

They get the same view as §2 for all users: emails, routing metadata and ciphertext. Without a user's DEK the ciphertext is AES-256-GCM protected. Since the wrapped DEK is not uploaded in Phase 19, a dump contains nothing to brute-force a passphrase against.

## 4. An attacker with Storage read access

The bucket is private and holds nothing in Phase 19. In later phases it will hold only ciphertext objects under `<user id>/…`: object names, sizes and timestamps would be visible, contents would not.

## 5. What the browser can see

Everything: this is where the plaintext lives and where encryption happens. That includes the local finance data, the session tokens and, while unlocked, the DEK (usable but not exportable). Anyone or anything that controls the browser or the page can see it: malware, a malicious extension, a compromised build, or XSS in the app.

## 6. What the encryption passphrase protects

It protects the **wrapped DEK**. Without the passphrase, the stored `keyring` record cannot be turned into a usable key. It keeps ciphertext in the cloud unreadable to Supabase, a database attacker, or someone who holds the session token. It does **not** protect the local plaintext finance database in IndexedDB; that is readable by anyone with access to this browser profile, as before. Sign-in and encryption are separate: a stolen email account or session does not reveal the passphrase or the key.

## 7. If the user loses the passphrase

Phase 19 has **no recovery**. The wrapped DEK on this device can no longer be unlocked, and anything encrypted with it cannot be decrypted by anyone, including the developer and Supabase. Local finance data is unaffected, because it is not encrypted with this key. A recovery key and device enrollment are planned for a later phase. For now a lost passphrase only loses synthetic test ciphertext.

## 8. If a session token is stolen

The attacker can act as that user against the Supabase API until the token expires or is revoked: read, overwrite or delete that user's `sync_records` rows (RLS still confines them to that one user).
- **What they get:** ciphertext only. Records they overwrite with their own ciphertext fail authentication for the real user's key, because the AAD binds each record to its key and context.
- **Remaining risks:** deleting records, and replaying an older valid ciphertext of the same record (rollback). Detecting rollback is Phase 20 work (server revision checks).
- **Reduce the damage:** sign out with global scope (revokes refresh tokens) and keep access tokens short-lived. A stolen token does not reveal the passphrase or the DEK.

## 9. What logout does

1. Calls Supabase `signOut` with global scope, which revokes the refresh token on the server. When offline, it falls back to local scope and only forgets it on this device.
2. Clears the in-memory cloud state (user, email).
3. **Locks the key:** drops the only reference to the unwrapped `CryptoKey`. JavaScript cannot zero memory; the key becomes unreachable and garbage-collectable, not wiped.
4. **Keeps** all local finance data and the wrapped key (the passphrase is needed again to unlock).
5. The sync gate stays closed: it requires signed-in **and** unlocked **and** online **and** sync enabled, and there is no sync engine yet. Nothing can upload while signed out.

The same happens when the session ends by itself (refresh token rejected, or sign-out in another tab).

## 10. What local browser storage contains

| Store | Contents | Sensitivity |
| --- | --- | --- |
| IndexedDB business tables | Accounts, transactions, debts, etc. (plaintext) | Sensitive, required locally |
| IndexedDB `attachmentBlobs` | Receipt files (plaintext) | Sensitive, required locally |
| IndexedDB `syncOutbox`, `syncTombstones`, `syncState`, `syncSettings` | Record ids and operations, device id, sync flags; no finance values | Low |
| IndexedDB `keyring` | Wrapped DEK, KDF salt and iterations, key id | Sensitive; useless without the passphrase |
| IndexedDB `meta` | Last backup time, setup flags | Low |
| `localStorage["pf-cloud-auth"]` | Supabase access + refresh token, user id, email | Authentication material |
| Memory only | Unwrapped DEK (while unlocked), passphrase (only during setup/unlock) | Secret |

## 11. What a backup contains

Backup format v1, data schema 1, unchanged: accounts, categories, debts, recurring obligations, scheduled payments, transactions, budgets, attachment metadata and attachment files (base64). All of it is plaintext, as before. The file is not encrypted and the UI says so.

## 12. What a backup does NOT contain

Session tokens (access or refresh), the user's email or id, the wrapped or unwrapped DEK, the passphrase, the key id, the device id, the outbox, tombstones or sync state, the `meta` table, and any Supabase URL or key. Tests check this, and restore keeps this device's `keyring`.

## Secrets and the browser bundle

- **Allowed in the browser:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (anon JWT or `sb_publishable_…`).
- **Refused at build time** (`vite.config.ts`): any `VITE_` variable whose name suggests a secret (SERVICE_ROLE, SECRET, PASSWORD, PASSPHRASE, PRIVATE, JWT, RECOVERY), and any value that is a `sb_secret_…` key or a JWT with a privileged role.
- **Refused at runtime** (`readCloudConfig`): the same keys. The cloud then stays off; the app still works.
- **Never** in the repository: `.env*` (except `.env.example`), keys and backups are git-ignored.

## Known limits

- **Code integrity:** a compromised GitHub account, Pages deployment or npm dependency could ship code that reads plaintext or the passphrase. End-to-end encryption does not protect against the code itself. Planned mitigations: CSP, dependency pinning and review, subresource integrity where possible.
- **Metadata:** record types, counts, sizes and timing are visible to the server (§2).
- **PBKDF2, not Argon2:** Web Crypto has no memory-hard KDF. 600,000 iterations follows current OWASP guidance for PBKDF2-SHA-256.
- **Local data is not encrypted at rest** beyond what the OS or browser provide.

## Not in Phase 19 (later phases)

Multi-device sync, conflict resolution, device list and revocation UI, a production recovery-key flow, key rotation, uploading the wrapped key for device enrollment, migration of existing local data to the cloud, attachment synchronization, and server-side accounting operations.
