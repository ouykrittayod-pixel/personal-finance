# Design system

The visual foundation for every screen. **Pages compose these components and
tokens; they do not invent colours, spacing or one-off controls.**

- Tokens: [`src/styles/tokens.css`](../src/styles/tokens.css) (+ shadcn base variables in `src/index.css`)
- Components: `import { … } from '@/components'` ([`src/components/index.ts`](../src/components/index.ts))
- Live gallery (dev only): `npm run dev` → <http://localhost:5173/#/design-system>

## Principles

1. **Numbers first.** Amounts are the largest, heaviest text in any view; labels are small and muted.
2. **Colour carries meaning, never decoration.** Every semantic colour is paired with a sign, icon or label so it also works for colour-blind users.
3. **Calm surfaces.** Hairline borders, no shadows except the floating "+", modest 8px radius, no gradients, no blur/glass.
4. **Cards only when they group.** Lists are plain rows with dividers, not a card per item.
5. **Touch first.** 44px minimum targets on phones, primary actions in the thumb zone, numeric keypad for money.
6. **Motion only for feedback.** Drawer/dialog open, route fade, progress width. All disabled with `prefers-reduced-motion`.

## Tokens

### Semantic colours

| Token | Use | Utilities |
|---|---|---|
| `primary` (teal) | Primary actions, active navigation, focus ring | `bg-primary`, `text-primary` |
| `income` (green) | Money in | `text-income`, `bg-income-muted` |
| `expense` (red) | Money spent | `text-expense`, `bg-expense-muted` |
| `debt` (orange) | Debt balances and debt payments | `text-debt`, `bg-debt-muted` |
| `warning` (amber) | Near a limit, due soon | `text-warning`, `bg-warning-muted` |
| `info` (blue) | Neutral information, pending, transfers | `text-info`, `bg-info-muted` |
| `neutral` (slate/gray) | Balances, secondary UI | `text-foreground`, `text-muted-foreground`, `bg-neutral-muted` |

Each has `-muted` (tinted background) and `-foreground` (text on a solid fill). Light and dark values are defined; all text colours meet WCAG AA (≥ 4.5:1).
Charts: `CHART_COLORS.income/expense/debt` for semantic series, `CHART_COLORS.series[0–4]` for categories.

### Spacing (semantic, responsive)

| Token | Phone | ≥ md | ≥ lg | Use |
|---|---|---|---|---|
| `page-x` / `page-y` | 16px | 24px | 32px (40px x at xl) | page gutters: `px-page-x` |
| `section` | 24px | 24px | 32px | between page sections: `gap-section` |
| `card` | 16px | 16px | 20px | card / row padding: `p-card`, `px-card` |
| `stack` | 12px | | | between items in a group |
| `inline` | 8px | | | icon ↔ label |
| `touch` | 44px | | | minimum target: `min-h-touch`, `size-touch` |

Layout sizes: `h-header` (56px), `h-bottom-nav` (64px), `w-sidebar` (256px), `w-sidebar-rail` (72px), `max-w-content` (72rem), `max-w-form` (32rem), `max-w-prose` (40rem).

### Typography

System fonts with Thai coverage (Segoe UI / Leelawadee UI / Noto Sans Thai / Thonburi) — no web-font download, works offline. Line heights are raised for Thai vowels/tone marks.

| Utility | Size | Use |
|---|---|---|
| `amount-xl` | 32px → 40px (lg) bold | dashboard hero figure |
| `amount-lg` | 24px semibold | stat cards, amount input |
| `amount-md` | 16px semibold | transaction rows |
| `amount-sm` | 14px medium | secondary figures, group totals |

Amounts always use `tabular-nums-money` so digits align.

### Motion

`--duration-fast` 120ms (hover/press), `--duration-base` 180ms (route fade, overlays), `--duration-slow` 260ms (progress), easing `ease-standard`.

### Breakpoints

| Name | Width | Navigation | Header |
|---|---|---|---|
| mobile | < 768px | bottom bar (3 items + central "+" + เพิ่มเติม), drawer menu | compact: mark + section |
| tablet | 768–1023px | icon rail sidebar | section + "+ บันทึกรายจ่าย" |
| desktop | 1024–1279px | full sidebar | same |
| large | ≥ 1280px | full sidebar, wider gutters, content capped at 72rem | same |

## Components

| Group | Components |
|---|---|
| Layout | `AppShell`, `Sidebar` (+ `NavList`, `Brand`), `MobileBottomNavigation`, `Header`, `PageHeader` |
| Surfaces | `Card` (+ header/title/content/footer) |
| Finance | `MoneyDisplay`, `StatCard`, `FinancialSummary`, `TransactionRow`, `TransactionList`, `TransactionGroup`, `CategoryBadge`, `StatusBadge` |
| Forms | `AmountInput`, `DateInput`, `AccountSelector`, `CategorySelector` (built on `ChoiceGroup`) |
| Actions | `PrimaryButton`, `SecondaryButton`, `IconButton` |
| Overlays | `Dialog`, `Drawer` (bottom sheet) |
| Navigation | `Tabs` |
| Feedback | `ProgressBar`, `EmptyState`, `LoadingState`, `ErrorState` |
| Data | `AttachmentPreview`, `ChartContainer` |

### MoneyDisplay

Presentation only — pass the final amount; it never calculates.

```tsx
<MoneyDisplay amount={income} tone="income" size="xl" />   // +฿27,500
<MoneyDisplay amount={spent} tone="expense" />             // −฿85
<MoneyDisplay amount={debtBalance} tone="debt" size="lg" /> // ฿2,581,670
<MoneyDisplay amount={balance} />                          // ฿3,280 (or −฿… if negative)
```

`sign`: `auto` (default: income +, expense −, others − only when negative), `plus`, `minus`, `none`.
Whole-baht amounts hide `.00`; pass `alwaysShowDecimals` for statements. Uses the typographic minus (−).

### Transaction visual language

| Type | Leading icon | Meta line | Amount |
|---|---|---|---|
| expense | category emoji/icon, neutral tint | `category · account` | red, `−` |
| income | category icon, green tint | `รายรับ · account` | green, `+` |
| debt_payment | card icon, **orange** tint | `ชำระหนี้ · from → card` | **orange**, `−` |
| transfer | ⇄ icon, blue tint | `โอนเงิน · from → to` | neutral, no sign |
| adjustment | sliders icon, gray | `ปรับยอด · account` | muted, signed |

Debt payments never use the expense red. Mapping lives in `components/finance/transaction-visuals.ts`.

### Fast expense entry (target 5–10 s)

`Drawer` (bottom sheet) → `AmountInput` (auto-focus, decimal keypad) → one tap on `CategorySelector` (4-column grid, most-used first) → `AccountSelector` pre-selected with the default account → `DateInput` defaults to today with "วันนี้ / เมื่อวาน" chips → `PrimaryButton size="lg"` in the sticky footer. The global "+" opens `#/expenses?new=1`.

## Accessibility checklist

- Landmarks: skip link, `nav` (main + bottom), `header`, `main#main-content`.
- Every icon-only control has a label (`IconButton` requires `label`).
- Focus: visible 2px teal ring (`focus-ring` utility or shadcn ring styles).
- Dialog/Drawer/menus: Radix focus trap, Escape to close, title + description.
- Selectors are native radio groups (arrow keys, `fieldset`/`legend`).
- Progress: `role="progressbar"` with value text; charts need a text `summary`.
- Loading announces via `role="status"`, errors via `role="alert"`.
- Bottom navigation hides while typing so it never covers the keyboard.

## Adding to the system

1. Need a colour/space/size? Add a token in `tokens.css`, not a raw value in a page.
2. Name custom utilities so they do not share a prefix with a Tailwind group (e.g. `amount-xl`, not `text-amount-xl`), otherwise `cn()` may treat a font size as a colour and drop it.
3. New reusable component → `src/components/<group>/`, export from `src/components/index.ts`, add a gallery example and a test.
