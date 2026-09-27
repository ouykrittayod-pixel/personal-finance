import { describe, expect, it } from 'vitest'
import { baht, makeCategory, makeDebt, makeObligation, makeScheduled } from '@/test/factories'
import { buildRecurringModel, frequencyLabel, orderForDetail, perLabel, scheduleLabel, type RecurringRawData } from './recurring-data'

const TODAY = '2026-09-25'
const monthly = (day: number) => ({ frequency: 'monthly' as const, interval: 1, startDate: '2026-01-01', dayOfMonth: day })

const raw: RecurringRawData = {
  categories: [makeCategory({ id: 'home', name: 'บ้าน', icon: '🏠' }), makeCategory({ id: 'phone', name: 'โทรศัพท์', icon: '📱' })],
  accounts: [],
  debts: [makeDebt({ id: 'cc', name: 'บัตรเครดิต KBank' })],
  obligations: [
    makeObligation({ id: 'rent', name: 'ค่าเช่า', expectedAmountSatang: baht(7_800), categoryId: 'home', recurrence: monthly(6) }),
    makeObligation({ id: 'mobile', name: 'ค่าโทรศัพท์', expectedAmountSatang: baht(699), categoryId: 'phone', recurrence: monthly(15) }),
    makeObligation({ id: 'card', name: 'บัตรเครดิต KBank', expectedAmountSatang: baht(5_000), debtId: 'cc', recurrence: monthly(20) }),
    makeObligation({ id: 'gym', name: 'ฟิตเนส', expectedAmountSatang: baht(1_200), categoryId: 'home', recurrence: monthly(1), pausedAt: 'x' }),
    makeObligation({ id: 'old', name: 'ของเก่า', expectedAmountSatang: baht(1), categoryId: 'home', recurrence: monthly(1), archivedAt: 'x' }),
  ],
  payments: [
    makeScheduled({ sourceId: 'rent', dueDate: '2026-09-06', status: 'paid', expectedAmountSatang: baht(7_800) }),
    makeScheduled({ sourceId: 'rent', dueDate: '2026-10-06', expectedAmountSatang: baht(7_800) }),
    makeScheduled({ sourceId: 'mobile', dueDate: '2026-09-15', status: 'skipped', expectedAmountSatang: baht(699) }),
    makeScheduled({ sourceId: 'mobile', dueDate: '2026-10-15', expectedAmountSatang: baht(699) }),
    makeScheduled({ sourceId: 'card', dueDate: '2026-09-20', expectedAmountSatang: baht(5_000) }),
    makeScheduled({ sourceId: 'card', dueDate: '2026-10-20', expectedAmountSatang: baht(5_000) }),
    makeScheduled({ sourceId: 'old', dueDate: '2026-09-01', expectedAmountSatang: baht(1) }),
  ],
}

const model = (filter: Parameters<typeof buildRecurringModel>[1]['filter'] = 'all', search = '') => buildRecurringModel(raw, { filter, search }, TODAY)

describe('buildRecurringModel', () => {
  it('lists live obligations: overdue first, then by next due date, paused last; deleted hidden', () => {
    const rows = model().rows
    expect(rows.map((r) => r.id)).toEqual(['card', 'rent', 'mobile', 'gym'])
    expect(rows[0]).toMatchObject({ status: { kind: 'overdue', label: 'ค้างชำระ 5 วัน' }, isDebt: true, categoryLabel: 'ชำระหนี้' })
    expect(rows[1]).toMatchObject({ dueText: 'ครบกำหนด 6 ต.ค. 2026', perLabel: '/ เดือน', icon: '🏠', status: { kind: 'pending' } })
    expect(rows[3]).toMatchObject({ paused: true, status: { kind: 'paused' } })
  })

  it('summarises this month’s obligations and counts active rules', () => {
    expect(model().summary).toEqual({ due: baht(12_800), paid: baht(7_800), outstanding: baht(5_000), overdueEarlier: 0, activeCount: 3 })
  })

  it.each([
    ['due', ['rent', 'mobile']],
    ['overdue', ['card']],
    ['paid', ['rent']],
    ['paused', ['gym']],
  ] as const)('filter %s', (filter, ids) => {
    expect(model(filter).rows.map((r) => r.id)).toEqual(ids)
  })

  it('searches by name and category', () => {
    expect(model('all', 'เช่า').rows.map((r) => r.id)).toEqual(['rent'])
    expect(model('all', 'โทรศัพท์').rows.map((r) => r.id)).toEqual(['mobile'])
    expect(model('all', 'ไม่มี').emptyReason).toBe('no_match')
  })

  it('is empty with no rules', () => {
    expect(buildRecurringModel({ ...raw, obligations: [], payments: [] }, { filter: 'all', search: '' }, TODAY).emptyReason).toBe('no_data')
  })
})

describe('labels', () => {
  it('describes frequency and schedule in Thai', () => {
    expect(frequencyLabel({ frequency: 'monthly', interval: 1 })).toBe('ทุกเดือน')
    expect(frequencyLabel({ frequency: 'weekly', interval: 2 })).toBe('ทุก 2 สัปดาห์')
    expect(perLabel({ frequency: 'monthly', interval: 3 })).toBe('/ 3 เดือน')
    expect(perLabel({ frequency: 'yearly', interval: 1 })).toBe('/ ปี')
    expect(scheduleLabel(monthly(15))).toBe('ทุกเดือน วันที่ 15')
    expect(scheduleLabel({ frequency: 'weekly', interval: 1, startDate: '2026-09-25', dayOfWeek: 1 })).toBe('ทุกสัปดาห์ วันจันทร์')
    expect(scheduleLabel({ frequency: 'yearly', interval: 1, startDate: '2026-01-01', monthOfYear: 3, dayOfMonth: 15 })).toBe('ทุกปี วันที่ 15 มีนาคม')
  })
})

describe('occurrence order in the detail', () => {
  it('unpaid first, oldest first (the overdue one is the first to pay); then paid / skipped history, newest first', () => {
    const sp = (dueDate: string, status: 'pending' | 'paid' | 'skipped') => makeScheduled({ id: `sp-${dueDate}`, sourceId: 'rent', dueDate, status })
    const ordered = orderForDetail([
      sp('2026-12-06', 'paid'),
      sp('2026-11-06', 'pending'),
      sp('2026-09-06', 'pending'),
      sp('2026-10-06', 'pending'),
      sp('2026-08-06', 'skipped'),
      sp('2026-07-06', 'paid'),
    ])
    expect(ordered.map((p) => `${p.dueDate}:${p.status}`)).toEqual([
      '2026-09-06:pending',
      '2026-10-06:pending',
      '2026-11-06:pending',
      '2026-12-06:paid',
      '2026-08-06:skipped',
      '2026-07-06:paid',
    ])
  })
})
