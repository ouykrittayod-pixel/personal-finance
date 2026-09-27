import type { CategoryTemplate } from '@/db/repositories'

/**
 * Expense categories offered when the user has none. Created only when the
 * user taps "สร้างหมวดหมู่พื้นฐาน"; these are labels, not financial records.
 */
export const STARTER_EXPENSE_CATEGORIES: readonly CategoryTemplate[] = [
  { name: 'อาหาร', icon: '🍚' },
  { name: 'เครื่องดื่ม', icon: '☕' },
  { name: 'เดินทาง', icon: '🚆' },
  { name: 'Shopping', icon: '🛍️' },
  { name: 'บ้าน', icon: '🏠' },
  { name: 'สุขภาพ', icon: '💊' },
  { name: 'การศึกษา', icon: '📚' },
  { name: 'ออกกำลังกาย', icon: '🏃' },
  { name: 'อื่น ๆ', icon: '📦' },
]

/** Income categories offered the same way (explicit tap only). */
export const STARTER_INCOME_CATEGORIES: readonly CategoryTemplate[] = [
  { name: 'เงินเดือน', icon: '💼' },
  { name: 'รายได้เสริม', icon: '🧩' },
  { name: 'โบนัส', icon: '🎁' },
  { name: 'ค่าคอมมิชชั่น', icon: '🤝' },
  { name: 'ดอกเบี้ย', icon: '🏦' },
  { name: 'เงินคืน', icon: '↩️' },
  { name: 'รายได้อื่น', icon: '💰' },
]
