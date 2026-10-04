# การเงินส่วนตัว — Personal Finance

A personal finance web app for a single user, used from a phone and a computer.
Thai UI, THB only (V1), no backend of its own: **the data lives in the user's own Google Drive**; each browser keeps
only a disposable cache in IndexedDB so the app opens instantly and works offline. See [Google Drive storage](#google-drive-storage).

> Status: **foundation + design system + Dashboard + Quick Expense + Transactions + Recurring + Debts + Income + Accounts & Transfers + Budget + Calendar + Analytics + Backup / Restore / Export + First-run setup & categories + Import Center (dev preview only).**
> The "รายจ่ายประจำวัน" page (`#/expenses`) is still a placeholder; entering expenses happens through Quick Expense ("+").
>
> Design system: see [docs/design-system.md](docs/design-system.md). Live gallery in dev: `#/design-system`.

---

## Quick start

Requires Node.js 22+ (developed on Node 24).

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command              | What it does                                              |
| -------------------- | --------------------------------------------------------- |
| `npm run dev`        | Dev server with hot reload                                |
| `npm run typecheck`  | TypeScript (strict) project check                         |
| `npm run lint`       | Oxlint, warnings fail the run                             |
| `npm test`           | Vitest, single run                                        |
| `npm run test:watch` | Vitest watch mode                                         |
| `npm run build`      | Type-check + production build into `dist/`               |
| `npm run preview`    | Serve `dist/` locally (service worker works here, not in dev) |
| `npm run check`      | typecheck + lint + test + build (run before pushing)       |

---

## Tech stack

| Concern        | Choice                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| Build          | Vite 8, TypeScript 6 (`strict`, `noUncheckedIndexedAccess`)            |
| UI             | React 19, Tailwind CSS 4, shadcn/ui (Radix, "nova" style), lucide icons |
| Routing        | React Router 8, **hash router** (`#/expenses`)                         |
| Storage        | IndexedDB via Dexie 4 + `dexie-react-hooks` (`useLiveQuery`)           |
| Forms / validation | Controlled React forms + Zod (backup file validation)              |
| Dates          | date-fns + `Intl` (Gregorian calendar)                                 |
| Charts         | Recharts (installed, used by Analytics later)                          |
| PWA            | vite-plugin-pwa (Workbox `generateSW`, auto-update)                    |
| Tests          | Vitest, Testing Library, jsdom, fake-indexeddb                         |
| Lint           | Oxlint                                                                 |
| Deploy         | GitHub Actions → GitHub Pages                                          |

---

## Project structure

```
src/
  app/
    router/        createHashRouter, route table, NAV_ITEMS (single source for nav)
    layout/        AppLayout (renders AppShell), 404, error boundary
    dev/           DEV-only design-system gallery (excluded from production builds)
    providers/     AppProviders, StorageProvider (opens DB, requests persistence)
  features/        one folder per feature; each exports its page from index.ts
    dashboard/ expenses/ transactions/ recurring/ debts/ income/ accounts/
    calendar/ budget/ analytics/ settings/
    attachments/   (no route; receipts UI will live inside other features)
    backup/        backup file format, validation, restore, data export (Settings)
  db/
    dexie.ts       FinanceDatabase class + app-wide `db` instance
    schema.ts      versioned IndexedDB schema (migrations)
    persistence.ts navigator.storage.persist() / estimate()
    repositories/  table access with domain logic (factory per database)
  domain/          pure TypeScript, no React/Dexie — easy to unit test
    money.ts         integer-satang money maths & formatting
    entities.ts      persisted entity types
    transactions.ts  transaction model rules (account effects, validation)
    recurrence.ts    recurrence rule type (generation comes later)
    amortization.ts  loan amortization estimates
    budget.ts        budget plan vs. actual spending
  styles/tokens.css  design tokens (semantic colours, spacing, type, motion)
  components/
    index.ts       design-system entry point — pages import from '@/components'
    layout/        AppShell, Sidebar, MobileBottomNavigation, Header, PageHeader
    finance/       MoneyDisplay, StatCard, FinancialSummary, TransactionRow/List, badges
    forms/         AmountInput, DateInput, AccountSelector, CategorySelector
    actions/       PrimaryButton, SecondaryButton, IconButton
    overlays/      Dialog, Drawer
    navigation/    Tabs
    feedback/      ProgressBar, EmptyState, LoadingState, ErrorState
    data/          AttachmentPreview, ChartContainer, chart colours
    ui/            shadcn/ui primitives (generated, adjusted to tokens)
    PagePlaceholder.tsx
  lib/
    i18n/          t() + Thai message catalog, APP_LOCALE
    formatting/    formatTHB, formatDate, formatBytes bound to the app locale
    dates/         ISO date helpers
    ids/           newId() (crypto.randomUUID)
    utils.ts       cn() class merging (shadcn)
  test/setup.ts    jest-dom matchers, fake IndexedDB, cleanup
```

Import alias: `@/…` → `src/…`.

**Dependency direction:** `features → app/components/lib → db → domain`. `domain/` imports nothing from the rest of the app.

---

## Money rules

- Every monetary value is an **integer number of satang** (`Satang` branded type; ฿1 = 100 satang).
- **Never** use floating-point for money. Do not write `amount * 1.07` or `Number(input) * 100`.
- Use `domain/money.ts`:
  - `parseBaht("1,234.50")` → `123450` (string parsing, no floats)
  - `add`, `subtract`, `sum`, `multiply` (integer qty), `negate`, `abs`
  - `multiplyRatio(a, num, den, rounding)` and `percentOf(a, bps)` — BigInt maths with explicit rounding (`half-up`, `half-even`, `floor`, `ceil`, `truncate`)
  - `allocate(total, weights)` — splits that always add back up exactly
  - `toDecimalString` for inputs/CSV, `formatMoney` / `formatTHB` for display (`฿1,234.50`)
- Interest/percentage rates are integer **basis points** (1% = 100 bps).
- All operations throw `MoneyError` rather than silently losing precision beyond `Number.MAX_SAFE_INTEGER`.

---

## Data model

### Transaction types

One unified `Transaction` entity; the `type` decides how balances and reports treat it.

| type           | from `accountId` | `toAccountId`           | counts as spending |
| -------------- | ---------------- | ----------------------- | ------------------ |
| `expense`      | −amount          | —                       | **yes**            |
| `income`       | +amount          | —                       | no (income)        |
| `transfer`     | −amount          | +amount (required)      | no                 |
| `debt_payment` | −amount          | +amount (liability)     | **no**             |
| `adjustment`   | ±amount (signed) | —                       | no                 |

Account balance sign convention: assets positive, **liabilities negative** (−฿5,000 = ฿5,000 owed). Net worth = Σ balances.

**Credit card example**

1. Groceries ฿500 on the card → `expense` from the card account. Card −500 (debt up). Spending +500.
2. Pay the card ฿500 from the bank → `debt_payment` bank → card. Bank −500, card +500. **No new expense** — spending was already counted at purchase time.

These rules live in `domain/transactions.ts` (`accountEffects`, `countsAsSpending`, `validateTransaction`) and are covered by tests.

### Recurring obligations

```
RecurringObligation  (template: rent, phone bill…; NOT a transaction)
        ↓ generates
ScheduledPayment     (one due occurrence; pending | paid | skipped;
                      unique per source + due date)
        ↓ when actually paid
Transaction          (linked both ways: scheduledPaymentId / transactionId)
```

### Debts

`Debt` is its own entity. Its payment history = `debt_payment` transactions with that `debtId` (indexed) + its
`ScheduledPayment`s (`sourceType: 'debt'`). Two balance models — see [Debts & repayment](#debts--repayment).

### IndexedDB schema (version 4)

| Table                  | Indexes                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `accounts`             | `id`, kind, sortOrder                                                                             |
| `categories`           | `id`, kind, parentId, sortOrder                                                                   |
| `transactions`         | `id`, date, type, accountId, toAccountId, categoryId, debtId, scheduledPaymentId, *tags, [type+date], [accountId+date] |
| `recurringObligations` | `id`, name                                                                                        |
| `scheduledPayments`    | `id`, **unique** [sourceType+sourceId+dueDate], [sourceType+sourceId], dueDate, status, [status+dueDate], transactionId |
| `debts`                | `id`, kind, status, linkedAccountId                                                               |
| `budgets`              | `id`, **unique** [month+categoryId], month                                                        |
| `attachments`          | `id`, transactionId, createdAt (metadata only)                                                    |
| `attachmentBlobs`      | `id` (binary data, same id as attachment)                                                         |
| `meta`                 | `key` (lastBackupAt, …)                                                                           |
| `syncOutbox`           | **[tableName+recordId]**, seq, tableName (device-local, v2)                                       |
| `syncTombstones`       | **[tableName+recordId]**, tableName (device-local, v2)                                            |
| `syncState`            | `key` (device-local, v2)                                                                          |
| `syncSettings`         | `key` (device id, sync off; device-local, v2)                                                     |

The database starts **empty** — no demo or seed data.

Two version numbers: the **Dexie version** (`LATEST_SCHEMA_VERSION`, now 4) describes local storage, including device-only tables; the **data schema version** (`DATA_SCHEMA_VERSION`, still 1) describes business records and is what backups carry. v2 added only device-local tables, v3 added a `keyring` table for a since-removed encrypted cloud experiment and v4 drops it again, so backups are unchanged (format v1, schema 1).

### Changing the schema

1. **Never edit a shipped version** in `src/db/schema.ts`; append `{ version: n + 1, stores: {…}, upgrade? }`.
2. List only tables whose indexes change; `null` deletes a table.
3. Transform existing data in `upgrade(tx)`.
4. Bump `BACKUP_FORMAT_VERSION` when entity shapes change and keep older backups importable.
5. Add a test that opens the previous version with data and upgrades it.
6. Bump `DATA_SCHEMA_VERSION` only when business records change shape.

Conventions: calendar dates are local `"YYYY-MM-DD"` strings (no time-zone drift); timestamps are UTC ISO strings; optional fields are omitted, not `null` (IndexedDB can't index null).

---

## Local change tracking (outbox and tombstones)

The bookkeeping the Drive sync builds on. It records what changed on this device; the sync engine reads it.

- **Device id** — `syncSettings.device`: a random `crypto.randomUUID()` made once per database, with `syncEnabled: false`. No hardware or browser fingerprint. Not in backups.
- **Outbox** — every write to a synced table (accounts, categories, transactions, recurring rules, scheduled payments, debts, budgets, attachment metadata) records `{ table, record id, create/update/delete, opId, seq }` in the **same IndexedDB transaction** as the write (Dexie DBCore middleware, `src/db/sync/tracking.ts`), so it can never miss a write or survive a rolled-back one. Entries hold **no record content** (the record is read when sent). Several changes to one record collapse into one entry (`collapseOutbox` in `src/domain/sync.ts`). Not tracked: `meta`, attachment blobs, schema upgrades, restore.
- **Tombstones** — deletes leave `{ table, record id, deletedAt, opId }` so another device can learn about them later; a record created and deleted before it was ever sent leaves nothing.
- **Order** — `seq` is a local counter, not a time; a sync pass treats entries up to the highest `seq` it read as sent.
- **Attachments** — metadata syncs later; blobs stay on the device for now.
- **Restore** — not recorded as changes; clears outbox and tombstones and bumps `syncState.epoch`. With Drive connected, the next sync replaces Drive's data with the restored set. The device id is kept.
- **Dev only** — `#/dev/integrity` shows device id, outbox counts and a consistency check (counts and ids only), and can reset sync metadata (business data untouched).

### Natural identities

| Record | Natural identity | Id |
| --- | --- | --- |
| Scheduled occurrence | sourceType + sourceId + dueDate (unique index) | **deterministic** UUID v5 (`occurrenceId`, `src/domain/identity.ts`) — every device generating "rent, 6 Oct" makes the same id |
| Starter category | kind + template name | **deterministic** UUID v5 (`starterCategoryId`) — two devices creating the starter set make identical records |
| Budget | month + categoryId (unique index) | random; a later sync merges budgets by the natural key |
| Everything else | none | random UUID v4 (created once, on one device) |

The v2 upgrade rewrote existing occurrence ids to their deterministic form and moved `transactions.scheduledPaymentId` along (paid history kept); older backups are converted the same way on restore. UUID v5 uses a small synchronous SHA-1 (`src/lib/ids/deterministic.ts`) because IndexedDB transactions end on an awaited WebCrypto call.

---

## Localization

- All UI text goes through `t('key')` from `@/lib/i18n`; Thai strings are in `lib/i18n/messages/th.ts`.
- `APP_LOCALE = 'th-TH-u-ca-gregory'` — plain `th-TH` would make `Intl` print Buddhist-era years (2569). Gregorian is used throughout.
- Code identifiers are English. To add a language: add `messages/<lang>.ts` typed as `Messages`, then make the language switchable.

---

## Google Drive storage

Drive holds the data set; a device only caches it. Nothing passes through a server of this app.

- **Where:** the app's hidden folder in the user's Drive (`appDataFolder`, scope `drive.appdata`): one JSON data file
  (`personal-finance-data.json`, `src/features/drive/remote-format.ts`, same strict record schemas as backups, plus
  tombstones) and one file per receipt (`attachment-<id>`). The app cannot see any other Drive file. `drive.file` is
  requested for the coming read-only Google Sheet; `openid email` identifies the account.
- **Sign-in:** OAuth 2.0 token by full-page redirect (`src/lib/google/auth.ts`, `oauth-redirect.ts`) — no pop-up, so
  it works the same in Safari, in a home-screen app and on desktop. Google sends the browser back to the app's address
  with the token in the URL fragment (random `state` checked); `src/app/oauth-return.ts` takes it out before the router
  starts. The token lasts ~1 hour and is cached in `localStorage`; when it expires the header chip says
  "แตะเพื่อเชื่อมต่อ" and sync waits, while the app keeps working from the cache. No refresh token, no client secret.
  The app address must be in the OAuth client's *Authorized redirect URIs* (and *JavaScript origins*).
- **Sync** (`src/features/drive/sync-engine.ts`, rules in `src/domain/drive-merge.ts`): read cache → read Drive file →
  merge → upload if Drive is behind (after checking the file version is unchanged; retried on conflict) → write the
  merge back to the cache in one untracked transaction (records edited during the pass are kept for the next one) →
  move receipt files both ways. Merge: union by table + id; later `updatedAt` wins (deterministic tie-break);
  tombstones delete unless the record changed after the delete; one budget per month + category and one occurrence
  per source + due date. Device clocks decide "later".
- **When:** on start, ~2.5 s after a local change, when the app returns to the foreground or comes online, and every
  3 minutes while visible (`src/features/drive/drive-sync.ts`).
- **Devices:** a device that has never connected shows the connect screen first and waits for the first download.
  Connecting another Google account empties the cache first (refused while unsynced changes exist). "ออกจากระบบ"
  revokes access and deletes the cache; the data stays in Drive. Restoring a backup replaces the data in Drive (and so
  on every device).
- **Configuration:** the OAuth Client ID is public; it goes in `src/lib/google/config.ts` (or `VITE_GOOGLE_CLIENT_ID`).
  Without one — and always in tests — the app runs local-only, as before. Google Cloud: enable Drive + Sheets APIs,
  OAuth consent screen (testing, own account as test user), Web client with authorized JavaScript origins
  `https://ouykrittayod-pixel.github.io` and `http://localhost:5173`.
- **Read-only Google Sheet** (`src/features/drive/sheet-tabs.ts`, `google-sheet.ts`): "การเงินส่วนตัว — ดูข้อมูล",
  created once with `drive.file` and found again from any device by a private app property. Tabs: about, monthly
  summary, transactions, accounts (with balances), debts (outstanding), budgets (spent / remaining). Rewritten in
  full after every sync that changed data, values written RAW (text never becomes a formula). Edits in the sheet are
  overwritten; a failed update never fails the sync and is retried on the next pass. The Drive card links to it.
- **CSP:** production builds carry a Content-Security-Policy meta tag allowing only this site's files plus Google
  sign-in, Drive and Sheets endpoints (`vite.config.ts`).

## Storage & offline

- `StorageProvider` opens IndexedDB before rendering and shows a clear error if IndexedDB is unavailable.
- The IndexedDB cache is disposable when Drive is connected; changes made offline wait in the outbox and go up on the
  next sync. `navigator.storage.persist()` is still requested so unsynced changes are not evicted.
- The service worker precaches the whole app, so after the first visit it loads with no network.

---

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` runs on every push to `main` (and checks PRs): `npm ci` → typecheck → lint → test → build → deploy.

One-time setup:

1. Push this project to a GitHub repository (e.g. `personal-finance`).
2. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. The site appears at `https://<user>.github.io/<repo>/`.

The workflow builds with `BASE_PATH=/<repo-name>/`, which sets Vite's `base`, the PWA `scope`/`start_url` and the service-worker path. Locally `BASE_PATH` is unset, so the base is `/`.
For a user site (`<user>.github.io`) or a custom domain, change `BASE_PATH` in the workflow to `/`.

Hash routing means deep links like `…/personal-finance/#/budget` work on Pages without a 404 workaround.

To test the Pages build locally (macOS/Linux shells):

```bash
BASE_PATH=/personal-finance/ npx vite build --outDir dist-pages
BASE_PATH=/personal-finance/ npx vite preview --outDir dist-pages
# open http://localhost:4173/personal-finance/
```

On Git Bash for Windows, prefix both commands with `MSYS_NO_PATHCONV=1` — otherwise `/personal-finance/` is rewritten into a Windows path.
In PowerShell: `$env:BASE_PATH='/personal-finance/'; npx vite build --outDir dist-pages; npx vite preview --outDir dist-pages`.

A public repository exposes only the code; financial data never leaves your device.

---

## Dashboard

`src/features/dashboard/`: summary figures, spending by category, 6-month cash flow, recent transactions,
upcoming payments and a debt overview for the selected month (`#/?month=YYYY-MM`; no parameter = current month).

- Financial rules live in `src/domain/reporting.ts` (pure, unit-tested): income = `income` only,
  expenses = `expense` only, **debt payments are a separate series and never counted as expenses**,
  transfers/adjustments are neither. Available money = balances of open cash/bank/savings/e-wallet accounts.
- Upcoming payments = unpaid scheduled payments due by the end of the selected month or within 7 days.
- Data is read through repositories in `src/db/repositories/` and kept live with `useLiveQuery`.

## Quick Expense

`src/features/expenses/quick-expense/`, opened from the "+" menu (phones) or "บันทึกรายจ่าย" (desktop header)
via `QuickEntryProvider` (`src/app/providers/`). Full-screen on phones, right-side panel on larger screens.

- Amount → category → save; description, account (pre-selected: last used), date (today), note and
  attachments live under "รายละเอียดเพิ่มเติม".
- "รายการที่ใช้บ่อย": same description + category + amount recorded ≥ 2 times in the last 90 days
  (`domain/suggestions.ts`). Tapping prefills; the user still presses Save.
- Save: `domain/transactions.buildExpense` validates, `transactionsRepository.createExpense` writes the
  transaction + attachment metadata + blobs in one IndexedDB transaction (all or nothing). The transaction id
  is fixed per form session, so double taps or retries can never create two records.
- An account is required by the domain model (balances depend on it). With no categories or accounts, the
  sheet shows a setup step that creates them only when the user taps.

## Transactions (ledger)

`src/features/transactions/` — search (description / category / account, debounced), type chips,
date presets (วันนี้ / สัปดาห์นี้ / เดือนนี้ / กำหนดเอง), period summary (income, expenses, debt payments —
separately), newest-first list grouped by day, 50 rows at a time. The open transaction is `?tx=<id>`.

- Rules: `domain/ledger.ts` (ordering, ranges, search, grouping, period totals).
- Edit reuses `features/transaction-form` (the same form as Quick Expense) and `domain/transactions.buildTransaction`
  (same validation as create; id, type, creation time and unedited fields are preserved).
- `transactionsRepository.update / delete` run in one IndexedDB transaction each (record + attachments +
  linked scheduled payment). Balances, debt outstanding and reports are derived, so they follow automatically.
- Attachment blobs load only in the detail view; the list reads attachment index keys only.

## Recurring payments

`src/features/recurring/` (`#/recurring`, detail at `?id=<obligation>`).

    RecurringObligation (rule)  →  ScheduledPayment (one occurrence)  →  Transaction (only when paid)

- Occurrence engine: `domain/recurrence.ts` (weekly / monthly / yearly, intervals, end date, month-end clamping).
- Scheduling rules: `domain/scheduling.ts` — generation window (this month → 3 months ahead), rule changes,
  derived status (overdue / due soon are never stored), monthly summary.
- Generation is idempotent (app start + Recurring page); the unique `[sourceType+sourceId+dueDate]` index blocks duplicates.
- `scheduledPaymentsRepository.markPaid` creates the transaction (actual date/amount/account, receipts), links it and marks
  the occurrence paid in one IndexedDB transaction; the transaction id is fixed per dialog so repeated confirms create one record.
  Debt-linked obligations create `debt_payment`s (never expenses).
- Editing a rule changes future unpaid occurrences only; pause removes future unpaid ones; delete archives the rule and keeps
  paid history, transactions and attachments.

## Debts & repayment

`src/features/debts/` (`#/debts`, detail at `?id=<debt>`), rules in `domain/debts.ts`, estimate in `domain/amortization.ts`.

**Loans** (mortgage, car, personal, installment, student, informal, other):

    outstanding principal(asOf) = opening balance (at its effective date)
                                + principal adjustments (top-ups / corrections, dated)
                                − explicitly allocated principal of debt payments

- The opening balance always has an explicit effective date; the original principal is optional context only and is
  never used as the current balance. Payments dated before the effective date are rejected.
- Every loan payment is either **split** (principal + interest + fee, all ≥ 0, summing exactly to the amount) or
  explicitly **unallocated** (stored without `principalSatang`; it never reduces principal and is shown separately).
  The split is never inferred.
- Principal may never exceed what was outstanding at that point in history (create, edit, debt edit, adjustments):
  no overpayment in this version.

**Credit cards**: the liability is the linked credit-card account's balance (purchases, refunds/adjustments, card
interest/fees recorded as expenses on the card, payments). There is no second balance and card payments carry no split.
One debt per card account. Statements are stored exactly as entered (date, balance, optional minimum, due date) and
create one scheduled payment; they never replace the live balance.

**Reporting**: expenses never include debt payments. Loan interest/fees are the cost of borrowing inside debt payments
(detail totals). Cash flow keeps income, expenses, debt payments and transfers as separate series. Past months show the
debt balance as of that month's end, labelled with the date.

**Schedules**: a loan with installment + due day can generate monthly installments (`sourceType: 'debt'`,
same generator, window and unique index as recurring obligations). One schedule owner per debt: a debt with its own
installments/statements cannot also be paid by a recurring obligation, and vice versa. Nothing is auto-paid.

**Paying**: the shared TransactionForm (loans show required principal / interest / fee fields with a live sum; cards
show none). Scheduled occurrences go through `markPaid` (atomic, fixed transaction id per dialog); unscheduled extra
repayments through `transactionsRepository.create`. Editing/deleting a payment uses the Transactions detail; deleting a
linked payment makes its occurrence unpaid again. Archiving a debt removes unpaid occurrences and keeps all history.

No IndexedDB version change: Phase 7 added only optional, unindexed fields (`Debt.startDate`, `maturityDate`,
`scheduleEnabled`, `scheduleFrom`, `schedulePausedAt`, `principalAdjustments`, `statements`, `archivedAt`;
`Transaction.principalSatang`). Older records load unchanged; an old loan payment without `principalSatang` is shown
as unallocated rather than guessed.

## Income

`src/features/income/` (`#/income`; `?tx=<id>` opens the shared transaction detail, `?rule=<id>` a recurring income rule).

- Income is an ordinary `income` transaction in `transactions` (no second table), created, edited and deleted through
  `buildTransaction` + the transactions repository. It needs a positive amount, a receiving account and an **income**
  category (an expense category is rejected). Balances, Dashboard, cash flow and Transactions derive from it.
- Transfers, expenses, debt payments and adjustments are never income (`domain/income.ts`: period, category and
  account totals; periods by transaction date).
- The "+" menu's รายรับ and the page's "บันทึกรายรับ" open the same quick sheet and shared TransactionForm in income
  mode; with no income categories the same explicit setup flow as Quick Expense offers starter income categories.
- The page reuses the Transactions loader, date presets, reversed-range handling, search debounce and detail sheet,
  and adds income-category and account filters. Summary: total, count, average per item (no "profit").

**Recurring income** reuses `RecurringObligation` → `ScheduledPayment` → transaction. One optional field,
`RecurringObligation.kind: 'income'` (absent = a payment: a bill, or a debt payment when `debtId` is set), marks the
direction; `ScheduledPayment.sourceType` stays `'obligation'` because it names the owner of the occurrence, not its
direction. "รับเงินแล้ว" uses the same atomic `markPaid` (fixed transaction id, paid/skipped checks) and creates an
`income` transaction with the actual date and amount; the rule's amount is never overwritten. Rule edits change future
unpaid occurrences only; deleting a rule keeps received income. Expected income is excluded from the Recurring page and
from the Dashboard's payments-to-make. No IndexedDB version change.

## Accounts & transfers

`src/features/accounts/` (`#/accounts`; `?id=<account>` opens its detail, `&tx=<id>` a transaction from it). Rules in
`domain/accounts.ts`.

- **Balances are derived, never stored**: opening balance (at its opening date) + the effects of transactions dated on
  or after it. Liabilities are negative (a card opened with ฿8,000 owed stores −8,000). The opening balance is the
  account's starting state — no transaction is created, and it is never income, expense or a transfer.
- **Available money** has one definition (`reporting.availableMoney`): active cash, bank, savings and e-wallet. Investment,
  `other`, credit cards and archived accounts are excluded. For a past month the Dashboard shows it as of that month-end
  (accounts not yet opened are left out), the same as-of rule as the debt card.
- **Kinds**: cash, bank, savings, e-wallet, credit card, investment, other (`other` added to the asset kinds; no
  migration). An edit may change the kind only within its class; the opening date may not move after the first
  transaction; changing the opening balance moves every derived balance by the difference (stated in the form).
- **Archive, never delete**: an archived account keeps all history, is not offered for new transactions, transfers or
  recurring rules (an edit may keep an archived account it already uses), and is not counted in available money. A card
  account that a live debt tracks cannot be archived until the debt is.
- **Transfers** are ordinary `transfer` transactions (`accountId` → `toAccountId`) created through the shared quick sheet
  and TransactionForm ("+" → โอนเงิน, or โอนเงิน / โอนจากบัญชีนี้ on Accounts); edit and delete go through the Transactions
  detail. Both sides must be **asset** accounts: money into or out of a credit card is a purchase (expense) or a card
  payment (debt payment), so a generic transfer can never bypass the card/debt rules. Transfers never count as income or
  expense and have their own cash-flow series.

## Budget

`src/features/budget/` (`#/budget`, month in `?month=YYYY-MM`). Rules in `domain/budget.ts`.

- A budget stores only the plan: `{ month: 'YYYY-MM', categoryId, limitSatang }` in the existing `budgets` table
  (unique `[month+categoryId]`, no schema change). Spent, remaining and percentage are always derived.
- **Spent** = expense transactions (`countsAsSpending`: type `expense` only) of that category whose transaction **date** is
  in the month. Income, transfers, debt payments (including loan interest inside them), card payments and adjustments
  never count. A credit-card purchase counts once, as the expense it is; paying the card later adds nothing. A recurring
  bill counts only once it is paid as an expense.
- **Overall monthly limit**: an optional budget with the reserved key `categoryId: '__overall'` (so the same unique index
  allows one per month). It is measured against all expenses of the month and is independent of category budgets.
- Status is a UI classification only: under 80% / 80–99.99% / ≥ 100% (exact integer comparisons; the displayed
  percentage rounds down). A limit of 0 never divides by zero. Budgets never block spending, never roll over, and are
  never created automatically.
- "ดูรายการ" opens the ledger with `#/transactions?month=YYYY-MM&type=expense&category=<id>`. The Dashboard shows a
  compact budget card (same domain function) only when the month has budgets.

## Calendar

`src/features/calendar/` (`#/calendar`, `?month=YYYY-MM`, open day `&day=YYYY-MM-DD`). View model in `domain/calendar.ts`.

- A read-only view over existing records — it never creates or stores anything. Per month it reads only that month's
  transactions and scheduled occurrences (date indexes), plus any transaction that paid an occurrence due in it.
- **Actual layer**: expense, income, debt payment and transfer transactions on their transaction date (adjustments are
  system corrections and are not shown).
- **Scheduled layer**: `ScheduledPayment` occurrences on their due date — bills, debt installments / card statements and
  expected income — with status upcoming / overdue / paid / skipped derived by the existing scheduling rules. Recurring
  rules themselves are never shown, so a rule and its occurrence never appear twice.
- A paid occurrence and the transaction that paid it are **one event** when paid on the due date. Paid on another day,
  the occurrence stays on its due date (showing the actual date and amount) and the payment appears on its own date,
  labelled as paying that occurrence.
- **Totals**: actual money only from transactions (income; expenses; debt payments; transfers — never mixed). "กำหนดจ่าย"
  and "คาดว่าจะได้รับ" count unpaid occurrences only, so nothing is counted twice and nothing expected is treated as actual.
- Phones get a day-by-day agenda; ≥ 768 px a Monday-first 7-column grid (3 events per cell, then "+ n รายการ"). Days open a
  detail sheet with per-day totals; every event opens its existing detail (transaction, recurring rule, income rule, debt).

## Analytics

`src/features/analytics/` (`#/analytics`, `?month=YYYY-MM`). Calculations in `domain/analytics.ts`, which only combines
the existing reporting, budget, debt and account functions — no second definition of any figure.

- **Overview**: รายรับ, รายจ่าย, ชำระหนี้ and เงินเหลือจากรายรับ (= income − expense; debt payments are not subtracted and are
  shown separately with the total outflow). Each is compared with the previous month (difference and %); a previous month
  of ฿0 shows the difference only, never an infinite percentage.
- **Accounting rules**: debt payments are never expenses; transfers are neither income nor expense; a credit-card purchase
  is an expense once (paying the card is a debt payment); scheduled / expected items are never actual money.
- **Categories**: donut (top 4 + อื่น ๆ) with a text equivalent, and a full table with shares; each row links to the
  ledger filtered to that month, expenses and category. Uncategorized expenses are "ไม่มีหมวดหมู่".
- **Budget**: the same numbers as `#/budget` (`getMonthlyBudgetSummary`), with a link there. Budgets are plans, not money.
- **Debts**: outstanding as of the month end (or today), payments this month, and principal / interest / fees only from
  explicit splits — an unsplit payment is never assumed to be principal; card payments have no split.
- **Accounts**: เงินที่ใช้ได้ (same definition as the Dashboard) as of the month end — today for the current month — and
  its change from the previous month end (not shown for a month that has not started). Cards show what is owed
  (ยอดหนี้บัตร) or an overpaid credit; investment / other accounts are listed but not counted.
- **Recurring**: expenses paid through a recurring bill's "ชำระแล้ว" flow (linked to the occurrence); unpaid occurrences are
  not expenses. Expenses entered by hand for a recurring bill are counted under "รายจ่ายอื่น".
- **Insights**: fixed-template factual sentences built only when the data supports them (changes vs last month, top
  category, budget usage/overruns, debt paid and its split, recurring share, available-money change). No advice, scores or
  predictions.
- Balances need history: the page reads every transaction dated up to the selected month's end (nothing after it).

## Backup, restore & export

`src/features/backup/`, shown on `#/settings`. Manual and local only: nothing is uploaded, scheduled or synced.

- **Backup** (`personal-finance-backup-YYYY-MM-DD.json`): the whole database as JSON: `format`, `formatVersion` (1),
  `appVersion`, `schemaVersion`, `exportedAt`, `currency: THB`, `calendar: gregorian`, per-table `counts`, and `data` with
  every table (accounts, categories, debts, recurringObligations, scheduledPayments, transactions, budgets, attachments,
  attachmentBlobs). Records are copied exactly as stored: same IDs, integer satang, `YYYY-MM-DD` dates, UTC timestamps.
  Attachment files are **base64 of the exact bytes** plus the blob MIME type (never re-encoded). `meta` (last backup
  time, install time) is device state: it is not backed up and a restore leaves it alone.
- **Restore** replaces the database (no merge). The file is fully checked first, in memory, with no writes: JSON,
  format, supported `formatVersion`, `schemaVersion` = current, currency/calendar, every collection present, every
  record matches its strict Zod schema (unknown fields rejected; money must be a safe integer; dates real calendar
  dates), declared counts, unique IDs per table, unique budget month+category and occurrence source+due date, every
  reference (account, category, debt, scheduled payment, recurring source, card account, attachment owner) and
  attachment metadata ⇄ binary one-to-one with matching byte size. Nothing is repaired or skipped: any failure rejects
  the file. The user then sees a preview (date, size, counts), then current-vs-file counts and an explicit
  confirmation.
- **Atomic**: all tables are cleared and refilled in **one** Dexie read-write transaction (blobs are decoded before it
  starts). Any error aborts the transaction and IndexedDB rolls back, so the current data stays as it was. Afterwards
  the stored counts are compared with the file. Pages refresh through their live queries; every total is derived again
  from the records (nothing derived is stored).
- **Versioning**: `readBackup` is the version boundary. A future format adds a parser (and a v1 → v2 upgrade) there;
  other versions are rejected with "ไฟล์นี้ใช้รูปแบบที่ไม่รองรับ".
- **Exports** (read-only): `personal-finance-data-YYYY-MM-DD.json` (all records, amounts in satang, attachment metadata
  only; not restorable) and `personal-finance-transactions-YYYY-MM-DD.csv` (UTF-8 with BOM for Excel, Thai headers
  วันที่…ค่าธรรมเนียม, amounts as exact baht decimals, names instead of IDs, text starting with = + - @ prefixed
  with an apostrophe).
- **Limits**: the backup and the file being restored are held in memory whole (no streaming: `JSON.parse` and
  IndexedDB need complete values). Fine for normal sizes (tens of MB); very large attachment sets need that much free
  memory. Backup files are not encrypted.

## Data integrity & hardening

- **Audit** (`domain/integrity.ts`, pure and read-only): orphans, duplicate IDs and business keys (budget month+category,
  occurrence source+due date), money (safe integers; signs and principal/interest/fee splits per the domain rules), dates
  and timestamps, transaction type rules (reuses `validateTransaction`), account reconciliation (ledger sum = both
  existing balance functions), loan reconciliation (opening + adjustments − explicit principal = `loanPosition`, no
  overpaid principal), credit cards (linked card account, owned once, payments go to the card with no split; a card in
  credit is a note), recurring rules and occurrences (paid ⇄ transaction link both ways, skipped/pending have no
  transaction, no unpaid occurrence on a deleted rule), budgets (expense category, positive limit, nothing derived
  stored), attachments (blob present, same size, valid MIME type, owner). Reports table / id / rule only, never record
  contents. Transactions dated before their account’s opening date are listed as notes (the opening balance includes
  them).
- **Report**: `#/dev/integrity` (development builds only) audits this browser’s database or a backup file without
  restoring it. `db/integrity-snapshot.ts` reads everything in one read-only transaction (blob sizes only).
- **Errors**: pages show their own error state for failed reads; a page that throws while rendering (e.g. a corrupt
  record) shows the error inside the app shell, so navigation keeps working.
- **Tests**: `src/app/hardening.test.ts` (every page’s loader agrees: accounting, card, transfer, budget, calendar,
  history and future months, backup/restore), `src/app/large-dataset.test.ts` (5,200 synthetic transactions: audit,
  pages, search, paging, backup round trip), `src/app/router/empty-database.test.tsx`. Synthetic data only
  (`src/test/synthetic.ts`, `src/test/representative.ts`).

## First-run setup & manual entry

The app is used by entering data by hand — no files to import.

- **Setup card** (`src/features/setup/`, on the Dashboard): on an empty database "เริ่มต้นจัดการเงินของคุณ" with numbered
  steps — accounts + opening balances, categories, income, debts, recurring bills, this month's budget, first expense —
  each opening the existing page (the first expense opens Quick Expense). Later it becomes a checklist
  ("ทำแล้ว x จาก 7"). Status is derived from the database by `db/setup-counts.ts` (indexed counts; never loads
  transaction history or attachments) and `domain/setup.ts`. Informational only: it creates nothing, blocks nothing,
  hides itself when everything is done, can be closed (`meta.setupDismissedAt`, device state) and shown again from
  Settings.
- **Categories** (Settings → หมวดหมู่): add, rename, change icon, archive / restore (never delete — history keeps the
  name). Duplicate open names of the same kind are refused; the kind never changes. The starter sets are still offered
  when a kind has none (created once).
- **Plain wording**: accounts ask for "ยอดตั้งต้น" / "วันที่เริ่มต้น" (a card asks for "ยอดค้างชำระตั้งต้น") — account
  settings, never transactions; loans use "ยอดหนี้ตั้งต้น" and explain that the balance falls with principal paid; the
  card-payment form says it is not a second expense; recurring bills are "not an expense until you press ชำระแล้ว".
- **Recurring detail**: unpaid occurrences are listed oldest first (the overdue one is the first "ชำระแล้ว"), then paid /
  skipped history newest first — so a user never prepays a future month by accident.
- No import in the product workflow: `#/import` stays a development-only preview tool (Phase 15A) and writes nothing.

## Import Center (Phase 15A — preview only)

`#/import` (development builds only; not in the navigation). Logic in `src/domain/import/` (pure), UI in
`src/features/import/`. **Phase 15A writes nothing to the database**: it reads existing accounts, categories, debts and
transactions for matching and duplicate checks, and produces a preview. The actual import is Phase 15B.

- **Files**: `.xlsx` and `.xls`, read in the browser with SheetJS 0.20.3 (installed from the official SheetJS CDN —
  the npm registry's `xlsx` is an old version with known vulnerabilities), loaded only on this page. The file never
  leaves the device; the file signature is checked (ZIP / OLE) so other files are not read as text. Excel dates come
  from the workbook's own date serial (1900/1904), never through time zones.
- **Inspection** (suggestions only): sheets with row/column counts; header row detected from the first 25 rows (text
  density, distinct values, known column words, data below) and overridable; per column: filled count/percentage,
  detected type (text, integer, decimal, date, currency, boolean, unknown) and likely meaning (date, amount, account,
  category, invoice, customer …); dataset kind (transaction history, receivables, sales history, debt schedule, account
  balance, budget, unknown). Sales and receivables are **not personal money**: "ไม่ใช่ข้อมูลรายรับ/รายจ่ายส่วนบุคคลโดย
  อัตโนมัติ", ignored unless the user maps them explicitly.
- **Mapping**: every app field (date, amount or money-out/money-in, type, account, destination account, category,
  debt, principal, interest, fee, description, note, reference, attachment reference) ← a source column or "ไม่ใช้",
  marked required / required-for / optional; the suggestion is shown as "แนะนำ" and can be changed. Distinct values of
  type / account / category / debt columns are mapped to existing records: exact names are matched; synonyms and
  partial names (Food → อาหาร, Cash → เงินสด) are **suggested only** and applied when the user accepts them; unmatched
  values stay unmapped (creating accounts or categories is a later, explicit decision).
- **Accounting rules**: a row's kind comes from its type value, or from an explicit choice (all expenses / all income /
  sign or money-out/in means direction) — never from "it has an amount"; otherwise the row is REVIEW REQUIRED. Known type
  words (รายจ่าย, รายรับ, ชำระหนี้, โอน, ยอดยกมา …) are recognised; anything else must be mapped (or marked "ไม่นำเข้า",
  which is counted). Opening balances are account settings, not transactions. Every transaction row is checked with the
  app's own `buildTransaction`: card purchases are expenses, card payments are debt payments into the card, transfers
  cannot involve a credit card, principal/interest/fees come only from explicit split columns and must add up.
- **Normalization**: text is trimmed only (never rewritten). Money → integer satang ("27,500.00", "฿27,500", "(1,200)",
  "-250"); more than 2 decimals → REVIEW (never rounded); NaN / Infinity / text → ERROR. Dates → YYYY-MM-DD: real Excel
  dates, YYYY-MM-DD, Thai month names, พ.ศ. years (converted and noted); D/M vs M/D only when unambiguous or when the user
  chooses the format — "03/04/2026" is AMBIGUOUS (REVIEW); 2-digit years → REVIEW; impossible dates → ERROR.
- **Validation**: ERROR / WARNING / INFO per row; status ready, warning, error, review or ignored. A dataset is READY only
  with 0 errors and 0 rows needing review; warnings are shown prominently.
- **Duplicates** (flagged, never removed): reference number + date + amount, else date + amount + account + description
  (date + amount alone is never used); within the file and against existing transactions. Invoice lines sharing a
  number with different amounts are noted, not flagged.
- **Traceability**: every preview row keeps file, sheet and Excel row number, the original cell values and the mapping.
- **Preview**: summary (source rows, ready, warnings, errors, possible duplicates, review, unclassified, ignored,
  opening balances, blank rows skipped) with "ยังไม่มีการบันทึกข้อมูลลงฐานข้อมูล"; filters (all / ready / warning /
  error / duplicate / review); a virtualized list (only visible rows in the DOM); row details; export
  `normalized-preview.json` / `normalized-preview.csv` (source, row, normalized values in satang, classification,
  status, messages).
- **Next (15B)**: import only with a backup first, a preview with 0 errors, explicit confirmation, a summary, the
  integrity audit and a new backup afterwards.

## Bundles

Every feature route is lazy-loaded; React/React Router and Dexie are split into long-lived vendor chunks
(`vite.config.ts`), and Recharts lives in one chunk shared only by the Dashboard and Analytics routes. The service worker precaches all chunks.

## Testing

- `src/domain/*.test.ts` — money arithmetic, parsing, rounding, allocation, formatting; transaction model (credit-card scenario).
- `src/db/dexie.test.ts` — schema opens at latest version, starts empty, unique constraints, indexes; meta repository. Uses `fake-indexeddb`.
- `src/lib/dates/dates.test.ts` — ISO dates, Gregorian Thai formatting.
- `src/app/router/routes.test.tsx` — every route renders, active nav link, 404.
- `src/components/**/*.test.tsx` — AppShell navigation/menu/keyboard behaviour, MoneyDisplay formatting, transaction visual language (debt ≠ expense), AmountInput parsing, selectors, progress and state components.
- `src/lib/utils.test.ts` — `cn()` keeps `amount-*` sizes next to semantic colours.

Tests run in Node by default; component tests opt into jsdom with a `// @vitest-environment jsdom` first line.
