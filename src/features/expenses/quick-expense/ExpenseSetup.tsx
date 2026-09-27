import { CheckCircle2, FolderPlus, Wallet } from 'lucide-react'
import { createElement, useId, useState, type FormEvent } from 'react'
import { PrimaryButton } from '@/components/actions/buttons'
import { ACCOUNT_KIND_VISUALS } from '@/components/finance/account-visuals'
import { AmountInput } from '@/components/forms/AmountInput'
import { ChoiceGroup } from '@/components/forms/ChoiceGroup'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { accountsRepository, categoriesRepository } from '@/db/repositories'
import type { AccountKind, ISODate } from '@/domain/entities'
import { tryParseBaht } from '@/domain/money'
import { t } from '@/lib/i18n'
import { newId } from '@/lib/ids'
import { STARTER_EXPENSE_CATEGORIES, STARTER_INCOME_CATEGORIES } from './starter-categories'

const SETUP_ACCOUNT_KINDS: readonly AccountKind[] = ['cash', 'bank', 'e_wallet', 'credit_card']

function Step({ done, icon: Icon, title, hint, children }: { done: boolean; icon: typeof Wallet; title: string; hint: string; children?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-stack rounded-lg border p-card">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {done ? <CheckCircle2 className="size-5" /> : <Icon className="size-5" />}
        </span>
        <div className="flex flex-col gap-0.5">
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{done ? t('setup.done') : hint}</p>
        </div>
      </div>
      {!done && children}
    </section>
  )
}

/**
 * Shown instead of the form when the user has no categories (of this kind)
 * or no account yet. Creates them only on an explicit tap — nothing is invented.
 */
export function ExpenseSetup({
  hasCategories,
  hasAccounts,
  today,
  kind = 'expense',
}: {
  hasCategories: boolean
  hasAccounts: boolean
  today: ISODate
  kind?: 'expense' | 'income'
}) {
  const income = kind === 'income'
  const starter = income ? STARTER_INCOME_CATEGORIES : STARTER_EXPENSE_CATEGORIES
  const [busy, setBusy] = useState<'categories' | 'account' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accountName, setAccountName] = useState(t('account.kind.cash'))
  const [accountKind, setAccountKind] = useState<AccountKind>('cash')
  const [balanceText, setBalanceText] = useState('')
  const nameId = useId()

  async function run(kind: 'categories' | 'account', action: () => Promise<unknown>) {
    setBusy(kind)
    setError(null)
    try {
      await action()
    } catch {
      setError(t('setup.error'))
    } finally {
      setBusy(null)
    }
  }

  function createAccount(event: FormEvent) {
    event.preventDefault()
    if (!accountName.trim()) return
    const entered = balanceText.trim() === '' ? undefined : tryParseBaht(balanceText)
    if (entered === null) return // AmountInput already shows the problem
    void run('account', () =>
      accountsRepository.create(
        // For a credit card the user enters what they owe; the account stores it as a negative balance.
        { name: accountName, kind: accountKind, openingDate: today, openingAmountSatang: entered ?? null },
        { id: newId(), now: new Date().toISOString() },
      ),
    )
  }

  return (
    <div className="flex flex-col gap-stack">
      <div>
        <h2 className="text-lg font-semibold">{t(income ? 'setup.incomeTitle' : 'setup.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('setup.hint')}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-expense/30 bg-expense-muted px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <Step
        done={hasCategories}
        icon={FolderPlus}
        title={t(income ? 'setup.incomeCategories.title' : 'setup.categories.title')}
        hint={t(income ? 'setup.incomeCategories.hint' : 'setup.categories.hint')}
      >
        <p className="text-sm">{starter.map((c) => `${c.icon ?? ''} ${c.name}`).join('  ')}</p>
        <PrimaryButton
          className="self-start"
          loading={busy === 'categories'}
          onClick={() =>
            void run('categories', () =>
              categoriesRepository.createStarterSet(kind, starter, {
                now: new Date().toISOString(),
                newId,
              }),
            )
          }
        >
          {t('setup.categories.create')}
        </PrimaryButton>
      </Step>

      <Step
        done={hasAccounts}
        icon={Wallet}
        title={t(income ? 'setup.incomeAccount.title' : 'setup.account.title')}
        hint={t(income ? 'setup.incomeAccount.hint' : 'setup.account.hint')}
      >
        <form onSubmit={createAccount} className="flex flex-col gap-stack">
          <ChoiceGroup
            legend={t('setup.account.kind')}
            layout="scroll"
            options={SETUP_ACCOUNT_KINDS.map((kind) => ({
              value: kind,
              label: t(ACCOUNT_KIND_VISUALS[kind].labelKey),
              icon: createElement(ACCOUNT_KIND_VISUALS[kind].icon),
            }))}
            value={accountKind}
            onValueChange={(value) => {
              const kind = value as AccountKind
              // Keep the suggested name in step with the kind until the user types their own.
              if (accountName === t(ACCOUNT_KIND_VISUALS[accountKind].labelKey)) setAccountName(t(ACCOUNT_KIND_VISUALS[kind].labelKey))
              setAccountKind(kind)
            }}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>{t('setup.account.name')}</Label>
            <Input id={nameId} value={accountName} onChange={(event) => setAccountName(event.target.value)} maxLength={60} required />
          </div>
          <div className="flex flex-col gap-1">
            <AmountInput
              size="md"
              label={accountKind === 'credit_card' ? t('account.kind.credit_card') + ' · ' + t('dashboard.debt.title') : t('setup.account.balance')}
              value={balanceText}
              onValueChange={(text) => setBalanceText(text)}
            />
            <p className="text-xs text-muted-foreground">{t('setup.account.balanceHint')}</p>
          </div>
          <PrimaryButton type="submit" className="self-start" loading={busy === 'account'} disabled={!accountName.trim()}>
            {t('setup.account.create')}
          </PrimaryButton>
        </form>
      </Step>
    </div>
  )
}
