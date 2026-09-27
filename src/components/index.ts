/**
 * Design-system entry point. Pages import from '@/components'.
 * Low-level shadcn primitives stay in '@/components/ui' and are used by these wrappers.
 */

// Layout
export { AppShell, type AppShellProps } from './layout/AppShell'
export { Sidebar, NavList, Brand } from './layout/Sidebar'
export { MobileBottomNavigation } from './layout/MobileBottomNavigation'
export { Header } from './layout/Header'
export { PageHeader } from './layout/PageHeader'
export type { ShellNavItem, ShellQuickAction } from './layout/types'

// Surfaces
export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'

// Finance presentation
export { MoneyDisplay, type MoneyDisplayProps } from './finance/MoneyDisplay'
export { formatSignedMoney, MINUS_SIGN, type MoneySign, type MoneySize, type MoneyTone } from './finance/money-format'
export { StatCard, type StatTone } from './finance/StatCard'
export { FinancialSummary, type SummaryFigure } from './finance/FinancialSummary'
export { TransactionRow, type TransactionRowProps } from './finance/TransactionRow'
export { TransactionList, TransactionGroup } from './finance/TransactionList'
export { TRANSACTION_VISUALS } from './finance/transaction-visuals'
export { CategoryBadge } from './finance/CategoryBadge'
export { StatusBadge, type StatusKind } from './finance/StatusBadge'

// Forms
export { AmountInput, type AmountTone } from './forms/AmountInput'
export { DateInput } from './forms/DateInput'
export { AccountSelector } from './forms/AccountSelector'
export { CategorySelector } from './forms/CategorySelector'
export { ChoiceGroup, type ChoiceOption } from './forms/ChoiceGroup'

// Actions
export { PrimaryButton, SecondaryButton, IconButton } from './actions/buttons'

// Overlays & navigation
export { Dialog, DialogClose } from './overlays/Dialog'
export { Drawer } from './overlays/Drawer'
export { Tabs, TabsContent, TabsList, TabsTrigger } from './navigation/Tabs'
export { MonthSelector } from './navigation/MonthSelector'

// Feedback
export { ProgressBar, type ProgressTone } from './feedback/ProgressBar'
export { EmptyState } from './feedback/EmptyState'
export { LoadingState } from './feedback/LoadingState'
export { ErrorState } from './feedback/ErrorState'

// Data
export { AttachmentPreview } from './data/AttachmentPreview'
export {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from './data/ChartContainer'
export { CHART_COLORS } from './data/chart-colors'
