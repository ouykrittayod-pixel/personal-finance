import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownLeft, CalendarClock, CalendarDays, CalendarX2, CreditCard, TrendingDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { SecondaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatCard } from '@/components/finance/StatCard'
import { ChoiceGroup } from '@/components/forms/ChoiceGroup'
import { PageHeader } from '@/components/layout/PageHeader'
import { MonthSelector } from '@/components/navigation/MonthSelector'
import { Card } from '@/components/ui/card'
import { scheduledPaymentsRepository } from '@/db/repositories'
import { CALENDAR_FILTERS, type CalendarFilter } from '@/domain/calendar'
import type { ISODate } from '@/domain/entities'
import { useIsWideScreen } from '@/hooks/use-media-query'
import { formatYearMonth, isYearMonth, todayISO, weekdayName, yearMonthOf } from '@/lib/dates'
import { formatDate, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { newId } from '@/lib/ids'
import { cn } from '@/lib/utils'
import { buildCalendarModel, dayTotals, loadCalendarData, type CalendarDay, type CalendarRawData } from './calendar-data'
import { CalendarEventChip, CalendarEventRow } from './components/CalendarEvent'
import { DayDetailSheet } from './components/DayDetailSheet'

/** Items shown inside a grid cell before "+ n รายการ". */
export const MAX_CELL_ITEMS = 3
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] // Monday first, like the rest of the app

export interface CalendarProps {
  today: ISODate
  /** Injected in tests. */
  load?: (month: string) => Promise<CalendarRawData>
  /** Brings scheduled occurrences up to date (the existing engine; never creates transactions). */
  generate?: () => Promise<unknown>
}

type LoadResult = { ok: true; raw: CalendarRawData } | { ok: false }

const defaultGenerate = () => scheduledPaymentsRepository.generateMissing(todayISO(), { now: new Date().toISOString(), newId })
const isISODate = (value: string | null): value is ISODate => value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)

function DayCell({ day, onOpen }: { day: CalendarDay; onOpen: () => void }) {
  const dayNumber = Number(day.date.slice(8, 10))
  if (!day.inMonth) {
    return (
      <div aria-hidden="true" className="min-h-28 border-t border-l p-1.5 text-xs text-muted-foreground/50">
        {dayNumber}
      </div>
    )
  }
  const shown = day.items.slice(0, MAX_CELL_ITEMS)
  const hidden = day.items.length - shown.length
  const label = day.items.length > 0 ? t('calendar.dayLabel', { date: formatDate(day.date, 'long'), count: day.items.length }) : t('calendar.dayEmptyLabel', { date: formatDate(day.date, 'long') })
  return (
    <button
      type="button"
      id={`calendar-day-${day.date}`}
      onClick={onOpen}
      aria-label={`${label}${day.isToday ? ` ${t('calendar.todayMark')}` : ''}`}
      aria-current={day.isToday ? 'date' : undefined}
      className="focus-ring flex min-h-28 min-w-0 flex-col gap-1 border-t border-l p-1.5 text-left transition-colors duration-(--duration-fast) hover:bg-muted/50"
    >
      <span
        aria-hidden="true"
        className={cn('flex size-6 items-center justify-center rounded-full text-xs font-medium', day.isToday && 'bg-primary text-primary-foreground')}
      >
        {dayNumber}
      </span>
      <span aria-hidden="true" className="flex min-w-0 flex-col gap-0.5">
        {shown.map((item) => (
          <CalendarEventChip key={item.id} item={item} />
        ))}
        {hidden > 0 && <span className="px-1 text-[11px] font-medium text-primary">{t('calendar.more', { count: hidden })}</span>}
      </span>
    </button>
  )
}

/**
 * The financial calendar: actual transactions on their dates and scheduled
 * occurrences on their due dates, read from the existing records (nothing is
 * created here). Month, open day and filter live in the URL
 * (`#/calendar?month=2026-09&day=2026-09-15`), so back closes the day.
 */
export function CalendarView({ today, load = loadCalendarData, generate = defaultGenerate }: CalendarProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const wide = useIsWideScreen()
  const currentMonth = yearMonthOf(today)
  const monthParam = searchParams.get('month')
  const month = isYearMonth(monthParam) ? monthParam : currentMonth
  const dayParam = searchParams.get('day')
  const openDay = isISODate(dayParam) && dayParam.startsWith(`${month}-`) ? dayParam : null
  const [filter, setFilter] = useState<CalendarFilter>('all')
  const [attempt, setAttempt] = useState(0)
  const focusToday = useRef(false)
  const [todayRequest, setTodayRequest] = useState(0)

  // The existing engine brings occurrences up to date (idempotent; never creates transactions).
  useEffect(() => {
    generate().catch(() => {})
  }, [generate, today])

  const result = useLiveQuery<LoadResult | null>(
    () => load(month).then((raw) => ({ ok: true as const, raw }), () => ({ ok: false as const })),
    [load, month, attempt],
  )
  const raw = result?.ok && result.raw.month === month ? result.raw : null
  const model = useMemo(() => (raw ? buildCalendarModel(raw, filter, today) : null), [raw, filter, today])

  const setParams = (next: { month?: string; day?: string | null }, replace = true) =>
    setSearchParams(
      (params) => {
        const updated = new URLSearchParams(params)
        if (next.month !== undefined) {
          if (next.month === currentMonth) updated.delete('month')
          else updated.set('month', next.month)
          updated.delete('day')
        }
        if (next.day !== undefined) {
          if (next.day) updated.set('day', next.day)
          else updated.delete('day')
        }
        return updated
      },
      { replace },
    )

  // "วันนี้": back to this month, then bring today into view and focus it.
  useEffect(() => {
    if (!focusToday.current || !model || month !== currentMonth) return
    focusToday.current = false
    const target = document.getElementById(wide ? `calendar-day-${today}` : `calendar-agenda-${today}`) ?? document.getElementById('calendar-agenda')
    target?.scrollIntoView?.({ block: 'center' })
    target?.focus?.()
  }, [model, month, currentMonth, today, wide, todayRequest])

  const dayItems = openDay && model ? (model.weeks.flat().find((d) => d.date === openDay)?.items ?? []) : []

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t('calendar.title')}
        description={month === currentMonth ? t('calendar.subtitle') : t('calendar.subtitleMonth', { month: formatYearMonth(month) })}
        actions={
          <>
            <SecondaryButton
              onClick={() => {
                focusToday.current = true
                setTodayRequest((n) => n + 1)
                if (month !== currentMonth) setParams({ month: currentMonth })
              }}
            >
              <CalendarDays aria-hidden="true" />
              {t('calendar.today')}
            </SecondaryButton>
            <MonthSelector value={month} onChange={(next) => setParams({ month: next })} currentMonth={currentMonth} />
          </>
        }
      />

      {!model && !(result && !result.ok) && <LoadingState variant="cards" count={4} />}
      {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}

      {model && (
        <>
          <section aria-label={t('calendar.summary')} className="grid grid-cols-2 gap-stack lg:grid-cols-4">
            <StatCard
              label={t('calendar.summary.in')}
              icon={ArrowDownLeft}
              tone="income"
              value={<MoneyDisplay amount={model.totals.moneyIn} tone="income" sign={model.totals.moneyIn === 0 ? 'none' : 'plus'} size="lg" />}
              hint={model.totals.expectedIn > 0 ? t('calendar.summary.expected', { amount: formatTHB(model.totals.expectedIn, { trimZeroFraction: true }) }) : t('calendar.summary.inHint')}
            />
            <StatCard label={t('calendar.summary.expense')} icon={TrendingDown} tone="expense" value={<MoneyDisplay amount={model.totals.expenses} size="lg" />} hint={t('calendar.summary.expenseHint')} />
            <StatCard label={t('calendar.summary.debt')} icon={CreditCard} tone="debt" value={<MoneyDisplay amount={model.totals.debtPayments} tone="debt" size="lg" />} />
            <StatCard label={t('calendar.summary.scheduled')} icon={CalendarClock} tone="info" value={<MoneyDisplay amount={model.totals.scheduledOut} size="lg" />} hint={t('calendar.summary.scheduledHint')} />
          </section>

          <ChoiceGroup
            legend={t('calendar.filter')}
            hideLegend
            layout="scroll"
            name="calendar-filter"
            options={CALENDAR_FILTERS.map((value) => ({ value, label: t(`calendar.filter.${value}`) }))}
            value={filter}
            onValueChange={(value) => setFilter(value as CalendarFilter)}
          />

          {wide ? (
            <Card className="gap-0 overflow-hidden py-0">
              <div role="grid" aria-label={t('calendar.grid', { month: formatYearMonth(month) })} className="grid grid-cols-7 border-r border-b">
                <div role="row" className="contents">
                  {WEEKDAYS.map((d) => (
                    <div role="columnheader" key={d} className="border-l px-1.5 py-2 text-center text-xs font-medium text-muted-foreground">
                      {weekdayName(d)}
                    </div>
                  ))}
                </div>
                {model.weeks.map((week) => (
                  <div role="row" key={week[0]!.date} className="contents">
                    {week.map((day) => (
                      <div role="gridcell" key={day.date} className="contents">
                        <DayCell day={day} onOpen={() => setParams({ day: day.date }, false)} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
          ) : model.agenda.length === 0 ? (
            <EmptyState icon={CalendarX2} title={filter === 'all' ? t('calendar.empty') : t('calendar.emptyFiltered')} description={filter === 'all' ? t('calendar.emptyHint') : undefined} />
          ) : (
            <section id="calendar-agenda" tabIndex={-1} aria-label={t('calendar.agenda')} className="flex flex-col gap-stack outline-none">
              {model.agenda.map((day) => (
                <Card key={day.date} className={cn('gap-1 px-card py-3', day.isToday && 'ring-2 ring-primary')}>
                  <button
                    type="button"
                    id={`calendar-agenda-${day.date}`}
                    onClick={() => setParams({ day: day.date }, false)}
                    aria-label={t('calendar.dayLabel', { date: formatDate(day.date, 'long'), count: day.items.length })}
                    className="focus-ring -mx-2 flex min-h-touch items-center justify-between gap-2 rounded-md px-2 text-left"
                  >
                    <span className="text-sm font-semibold">
                      {formatDate(day.date, 'long')}
                      {day.isToday && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">{t('calendar.todayMark')}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">{t('calendar.dayLabel', { date: '', count: day.items.length }).trim()}</span>
                  </button>
                  <ul className="-mx-2 flex flex-col divide-y divide-border">
                    {day.items.map((item) => (
                      <CalendarEventRow key={item.id} item={item} obligations={raw!.obligations} />
                    ))}
                  </ul>
                </Card>
              ))}
            </section>
          )}
          {wide && model.itemCount === 0 && <p className="text-sm text-muted-foreground">{filter === 'all' ? t('calendar.empty') : t('calendar.emptyFiltered')}</p>}
        </>
      )}

      <DayDetailSheet date={openDay} items={dayItems} totals={openDay && raw ? dayTotals(raw, openDay) : null} obligations={raw?.obligations ?? []} onClose={() => setParams({ day: null })} />
    </div>
  )
}

/** Route entry (lazy-loaded). */
export function CalendarPage() {
  const [today] = useState(todayISO)
  return <CalendarView today={today} />
}
