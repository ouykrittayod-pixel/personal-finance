import type { ReactNode } from 'react'
import { ProgressBar } from '@/components/feedback/ProgressBar'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import type { MoneyTone } from '@/components/finance/money-format'
import type { CreditCardProfile, InvestmentProfile } from '@/domain/account-profiles'
import type { Satang } from '@/domain/money'
import { formatDate, formatPercentBps, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'

function Figure({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}

const Money = ({ amount, tone = 'neutral' }: { amount: Satang; tone?: MoneyTone }) => <MoneyDisplay amount={amount} size="md" tone={tone} sign="none" />
const baht = (amount: Satang) => formatTHB(amount, { trimZeroFraction: true })

/** Credit card: limit, used, available, cycle and due date. */
export function CreditCardSection({ profile }: { profile: CreditCardProfile }) {
  const high = profile.usedBps !== undefined && profile.usedBps >= 8000
  return (
    <section aria-labelledby="card-profile" className="flex flex-col gap-stack rounded-lg border p-card">
      <h3 id="card-profile" className="text-sm font-semibold">
        {t('accounts.card.title')}
      </h3>
      {profile.limit !== undefined ? (
        <>
          <dl className="grid grid-cols-3 gap-stack">
            <Figure label={t('accounts.card.limit')}>
              <Money amount={profile.limit} />
            </Figure>
            <Figure label={t('accounts.card.used')}>
              <Money amount={profile.used} tone="debt" />
            </Figure>
            <Figure label={t('accounts.card.available')}>
              <Money amount={profile.available!} tone={profile.available! < 0 ? 'expense' : 'income'} />
            </Figure>
          </dl>
          <ProgressBar
            value={(profile.usedBps ?? 0) / 100}
            label={t('accounts.card.usedShare')}
            tone={high ? 'warning' : 'debt'}
            showValue
            valueText={t('accounts.card.usedOf', { used: baht(profile.used), limit: baht(profile.limit) })}
          />
          {high && <p className="text-xs text-warning">{t('accounts.card.highUse')}</p>}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('accounts.card.noLimit')}</p>
      )}
      {profile.inCredit > 0 && <p className="text-sm text-income">{t('accounts.inCredit', { amount: baht(profile.inCredit) })}</p>}

      <dl className="grid grid-cols-2 gap-stack border-t pt-3">
        <Figure label={t('accounts.card.statementDay')}>
          <span className="text-sm font-medium">{profile.statementDay ? t('accounts.card.everyDay', { day: profile.statementDay }) : '—'}</span>
        </Figure>
        <Figure label={t('accounts.card.dueDay')}>
          <span className="text-sm font-medium">{profile.paymentDueDay ? t('accounts.card.everyDay', { day: profile.paymentDueDay }) : '—'}</span>
        </Figure>
        {profile.cycle ? (
          <Figure label={t('accounts.card.cycleSpending')} hint={t('accounts.card.cycleRange', { start: formatDate(profile.cycle.start), end: formatDate(profile.cycle.end), count: profile.cycle.count })}>
            <Money amount={profile.cycle.spending} tone="expense" />
          </Figure>
        ) : (
          <Figure label={t('accounts.card.monthSpending')}>
            <Money amount={profile.spendingThisMonth} tone="expense" />
          </Figure>
        )}
        {profile.nextDueDate && (
          <Figure label={t('accounts.card.nextDue')}>
            <span className="text-sm font-medium">{formatDate(profile.nextDueDate)}</span>
          </Figure>
        )}
      </dl>

      {profile.lastStatement && (
        <dl className="grid grid-cols-2 gap-stack border-t pt-3">
          <Figure label={t('accounts.card.lastStatement', { date: formatDate(profile.lastStatement.statementDate) })}>
            <Money amount={profile.lastStatement.balance} tone="debt" />
          </Figure>
          <Figure label={t('accounts.card.minimumDue', { date: formatDate(profile.lastStatement.dueDate) })}>
            {profile.lastStatement.minimumDue !== undefined ? <Money amount={profile.lastStatement.minimumDue} /> : <span className="text-sm">—</span>}
          </Figure>
        </dl>
      )}
      {profile.plannedPayment && (
        <p className="border-t pt-3 text-sm text-muted-foreground">
          {t('accounts.card.planned', {
            name: profile.plannedPayment.name,
            amount: baht(profile.plannedPayment.amount),
            date: profile.plannedPayment.nextDate ? formatDate(profile.plannedPayment.nextDate) : '—',
          })}
        </p>
      )}
      {(profile.limit === undefined || !profile.statementDay || !profile.paymentDueDay) && <p className="text-xs text-muted-foreground">{t('accounts.card.setupHint')}</p>}
    </section>
  )
}

/** Investment: value, money put in, gain/loss, contributions and plans. */
export function InvestmentSection({ profile }: { profile: InvestmentProfile }) {
  const up = profile.gain >= 0
  return (
    <section aria-labelledby="investment-profile" className="flex flex-col gap-stack rounded-lg border p-card">
      <h3 id="investment-profile" className="text-sm font-semibold">
        {t('accounts.investment.title')}
      </h3>
      <dl className="grid grid-cols-2 gap-stack">
        <Figure label={t('accounts.investment.invested')} hint={t('accounts.investment.investedHint')}>
          <Money amount={profile.invested} />
        </Figure>
        <Figure label={t('accounts.investment.gain')} hint={profile.gainBps !== undefined ? formatPercentBps(profile.gainBps) : undefined}>
          <MoneyDisplay amount={profile.gain} size="md" tone={profile.gain === 0 ? 'neutral' : up ? 'income' : 'expense'} sign={profile.gain === 0 ? 'none' : up ? 'plus' : 'minus'} />
        </Figure>
        <Figure label={t('accounts.investment.thisMonth')}>
          <Money amount={profile.investedThisMonth} />
        </Figure>
        <Figure label={t('accounts.investment.thisYear')}>
          <Money amount={profile.investedThisYear} />
        </Figure>
        {profile.returns > 0 && (
          <Figure label={t('accounts.investment.returns')}>
            <Money amount={profile.returns} tone="income" />
          </Figure>
        )}
        {profile.fees > 0 && (
          <Figure label={t('accounts.investment.fees')}>
            <Money amount={profile.fees} tone="expense" />
          </Figure>
        )}
      </dl>
      <p className="text-xs text-muted-foreground">
        {profile.lastValuedOn ? t('accounts.investment.valuedOn', { date: formatDate(profile.lastValuedOn) }) : t('accounts.investment.neverValued')}
      </p>

      <div className="flex flex-col gap-2 border-t pt-3">
        <h4 className="text-sm font-medium">{t('accounts.investment.plans')}</h4>
        {profile.plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('accounts.investment.noPlans')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {profile.plans.map((plan) => (
              <li key={plan.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {plan.name}
                  <span className="text-xs text-muted-foreground">
                    {' · '}
                    {plan.paused ? t('status.paused') : plan.nextDate ? t('accounts.investment.next', { date: formatDate(plan.nextDate) }) : '—'}
                  </span>
                </span>
                <Money amount={plan.amount} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
