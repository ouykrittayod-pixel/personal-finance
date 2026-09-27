/**
 * DEV-ONLY component gallery (route #/design-system, not included in production builds).
 * Every figure here is an illustrative literal passed as props: nothing is read
 * from or written to the database.
 */
import { AlertTriangle, Banknote, CreditCard, FlaskConical, Inbox, Landmark, Plus, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import {
  AccountSelector,
  AmountInput,
  AttachmentPreview,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CategoryBadge,
  CategorySelector,
  CHART_COLORS,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  DateInput,
  Dialog,
  DialogClose,
  Drawer,
  EmptyState,
  ErrorState,
  FinancialSummary,
  IconButton,
  LoadingState,
  MoneyDisplay,
  PageHeader,
  PrimaryButton,
  ProgressBar,
  SecondaryButton,
  StatCard,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TransactionGroup,
  TransactionList,
  TransactionRow,
  type ChartConfig,
} from '@/components'
import { satang, type Satang } from '@/domain/money'
import { todayISO } from '@/lib/dates'
import { t } from '@/lib/i18n'

/** Sample amounts, written in baht for readability. */
const baht = (value: number): Satang => satang(value * 100)

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-stack">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

const SWATCHES = [
  ['primary', 'bg-primary', 'text-primary'],
  ['income', 'bg-income', 'text-income'],
  ['expense', 'bg-expense', 'text-expense'],
  ['debt', 'bg-debt', 'text-debt'],
  ['warning', 'bg-warning', 'text-warning'],
  ['info', 'bg-info', 'text-info'],
  ['neutral', 'bg-neutral', 'text-foreground'],
] as const

const CATEGORY_OPTIONS = [
  { value: 'food', label: 'อาหาร', icon: '🍚' },
  { value: 'drink', label: 'เครื่องดื่ม', icon: '☕' },
  { value: 'travel', label: 'เดินทาง', icon: '🚆' },
  { value: 'shopping', label: 'ช้อปปิ้ง', icon: '🛍️' },
  { value: 'home', label: 'ของใช้ในบ้าน', icon: '🏠' },
  { value: 'health', label: 'สุขภาพ', icon: '💊' },
  { value: 'fun', label: 'บันเทิง', icon: '🎬' },
  { value: 'other', label: 'อื่น ๆ', icon: '📦' },
]

const ACCOUNT_OPTIONS = [
  { value: 'cash', label: 'เงินสด', icon: <Banknote /> },
  { value: 'bank', label: 'KBank', icon: <Landmark /> },
  { value: 'wallet', label: 'TrueMoney', icon: <Wallet /> },
  { value: 'card', label: 'บัตรเครดิต', icon: <CreditCard /> },
]

const chartConfig = {
  income: { label: 'รายรับ', color: CHART_COLORS.income },
  expense: { label: 'รายจ่าย', color: CHART_COLORS.expense },
} satisfies ChartConfig

const CHART_SAMPLE = [
  { month: 'ก.ค.', income: 27500, expense: 19800 },
  { month: 'ส.ค.', income: 27500, expense: 22150 },
  { month: 'ก.ย.', income: 27500, expense: 8420 },
]

export function DesignSystemPage() {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [category, setCategory] = useState<string>()
  const [account, setAccount] = useState<string>('cash')
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t('dev.designSystem')} description={t('dev.sampleNotice')} />

      <Section title="Colour tokens">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {SWATCHES.map(([name, bg, text]) => (
            <div key={name} className="flex flex-col gap-1.5 rounded-md border p-2">
              <span className={`h-8 rounded-sm ${bg}`} />
              <span className={`text-xs font-medium ${text}`}>{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="MoneyDisplay">
        <Card className="px-card">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            <MoneyDisplay amount={baht(27500)} tone="income" size="xl" />
            <MoneyDisplay amount={baht(8420)} tone="expense" size="lg" />
            <MoneyDisplay amount={baht(3280)} size="lg" />
            <MoneyDisplay amount={baht(2581670)} tone="debt" size="lg" />
            <MoneyDisplay amount={baht(85)} tone="expense" />
            <MoneyDisplay amount={satang(8550)} tone="expense" size="sm" />
            <MoneyDisplay amount={baht(-1200)} />
          </div>
        </Card>
      </Section>

      <Section title="FinancialSummary">
        <Card className="px-card">
          <FinancialSummary
            primary={{ label: 'คงเหลือเดือนนี้', amount: baht(3280) }}
            items={[
              { label: 'รายรับ', amount: baht(27500), tone: 'income' },
              { label: 'รายจ่าย', amount: baht(8420), tone: 'expense' },
              { label: 'ชำระหนี้', amount: baht(15800), tone: 'debt', sign: 'minus' },
              { label: 'หนี้คงค้าง', amount: baht(2581670), tone: 'debt' },
            ]}
          />
        </Card>
      </Section>

      <Section title="StatCard + ProgressBar">
        <div className="grid gap-stack sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="รายรับ" icon={TrendingUp} tone="income" value={<MoneyDisplay amount={baht(27500)} tone="income" size="lg" />} hint="2 รายการ" />
          <StatCard label="รายจ่าย" icon={TrendingDown} tone="expense" value={<MoneyDisplay amount={baht(8420)} tone="expense" size="lg" />} hint="31 รายการ" />
          <StatCard
            label="งบอาหาร"
            icon={AlertTriangle}
            tone="warning"
            value={<MoneyDisplay amount={baht(4200)} size="lg" />}
            hint="จาก ฿5,000"
            footer={<ProgressBar value={84} label="งบอาหาร" tone="warning" showValue />}
          />
        </div>
        <Card className="gap-3 px-card">
          <ProgressBar value={35} label="ตัวอย่าง primary" showValue />
          <ProgressBar value={62} label="ตัวอย่าง debt" tone="debt" showValue />
          <ProgressBar value={112} label="ตัวอย่าง over" tone="expense" showValue />
        </Card>
      </Section>

      <Section title="TransactionRow / TransactionList">
        <Card className="gap-0 py-0">
          <TransactionGroup title="วันนี้" summary={<MoneyDisplay amount={baht(2585)} tone="expense" size="sm" />}>
            <TransactionRow
              type="expense"
              title="ข้าวกลางวัน"
              amount={baht(85)}
              date={todayISO()}
              categoryLabel="อาหาร"
              categoryIcon="🍚"
              accountLabel="เงินสด"
              hasAttachment
              onSelect={() => {}}
            />
            <TransactionRow type="income" title="เงินเดือน" amount={baht(27500)} date={todayISO()} accountLabel="KBank" categoryIcon="💰" onSelect={() => {}} />
            <TransactionRow
              type="debt_payment"
              title="ชำระบัตรเครดิต"
              amount={baht(2500)}
              date={todayISO()}
              accountLabel="KBank"
              toAccountLabel="บัตรเครดิต"
              onSelect={() => {}}
            />
            <TransactionRow type="transfer" title="ย้ายเงินเก็บ" amount={baht(1000)} date={todayISO()} accountLabel="KBank" toAccountLabel="ออมทรัพย์" />
            <TransactionRow type="adjustment" title="ปรับยอดเงินสด" amount={baht(-20)} date={todayISO()} accountLabel="เงินสด" />
          </TransactionGroup>
        </Card>
        <Card className="py-0">
          <TransactionList label="ตัวอย่างรายการแบบไม่จัดกลุ่ม">
            <TransactionRow type="expense" title="กาแฟ" amount={baht(55)} categoryLabel="เครื่องดื่ม" categoryIcon="☕" accountLabel="TrueMoney" />
          </TransactionList>
        </Card>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <CategoryBadge label="อาหาร" icon="🍚" />
          <CategoryBadge label="เดินทาง" color="var(--chart-2)" />
          <StatusBadge status="pending" />
          <StatusBadge status="due_soon" />
          <StatusBadge status="overdue" label="เกินกำหนด 3 วัน" />
          <StatusBadge status="paid" />
          <StatusBadge status="skipped" />
          <StatusBadge status="active" />
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <PrimaryButton>
            <Plus aria-hidden="true" /> บันทึก
          </PrimaryButton>
          <PrimaryButton loading>กำลังบันทึก</PrimaryButton>
          <SecondaryButton>ยกเลิก</SecondaryButton>
          <IconButton label="ตัวอย่างปุ่มไอคอน" icon={<FlaskConical />} />
          <PrimaryButton size="lg">ปุ่มใหญ่สำหรับฟอร์ม</PrimaryButton>
        </div>
      </Section>

      <Section title="Forms (quick expense entry)">
        <Card className="max-w-form px-card">
          <div className="flex flex-col gap-section">
            <AmountInput value={amount} onValueChange={(text) => setAmount(text)} tone="expense" autoFocus={false} />
            <CategorySelector options={CATEGORY_OPTIONS} value={category} onValueChange={setCategory} />
            <AccountSelector options={ACCOUNT_OPTIONS} value={account} onValueChange={setAccount} />
            <DateInput value={date} onValueChange={setDate} />
          </div>
        </Card>
      </Section>

      <Section title="Dialog / Drawer / Tabs">
        <div className="flex flex-wrap gap-2">
          <Dialog
            trigger={<SecondaryButton>เปิด Dialog</SecondaryButton>}
            title="ลบรายการนี้?"
            description="รายการจะถูกลบออกจากเครื่องนี้"
            footer={
              <>
                <DialogClose asChild>
                  <SecondaryButton>ยกเลิก</SecondaryButton>
                </DialogClose>
                <DialogClose asChild>
                  <PrimaryButton>ยืนยัน</PrimaryButton>
                </DialogClose>
              </>
            }
          />
          <Drawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            trigger={<SecondaryButton>เปิด Drawer</SecondaryButton>}
            title="บันทึกรายจ่าย"
            footer={
              <PrimaryButton size="lg" onClick={() => setDrawerOpen(false)}>
                บันทึก
              </PrimaryButton>
            }
          >
            <div className="flex flex-col gap-section">
              <AmountInput value={amount} onValueChange={(text) => setAmount(text)} tone="expense" />
              <CategorySelector options={CATEGORY_OPTIONS} value={category} onValueChange={setCategory} />
            </div>
          </Drawer>
        </div>
        <Tabs defaultValue="month">
          <TabsList>
            <TabsTrigger value="day">รายวัน</TabsTrigger>
            <TabsTrigger value="month">รายเดือน</TabsTrigger>
            <TabsTrigger value="year">รายปี</TabsTrigger>
          </TabsList>
          <TabsContent value="day" className="pt-2 text-sm text-muted-foreground">
            เนื้อหารายวัน
          </TabsContent>
          <TabsContent value="month" className="pt-2 text-sm text-muted-foreground">
            เนื้อหารายเดือน
          </TabsContent>
          <TabsContent value="year" className="pt-2 text-sm text-muted-foreground">
            เนื้อหารายปี
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="ChartContainer">
        <Card className="px-card">
          <ChartContainer title="รายรับ–รายจ่าย" description="3 เดือนล่าสุด (ตัวอย่าง)" summary="ตัวอย่างกราฟแท่งรายรับเทียบรายจ่าย" config={chartConfig}>
            <BarChart data={CHART_SAMPLE} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="income" fill="var(--color-income)" radius={3} />
              <Bar dataKey="expense" fill="var(--color-expense)" radius={3} />
            </BarChart>
          </ChartContainer>
        </Card>
      </Section>

      <Section title="AttachmentPreview">
        <div className="grid gap-2 sm:grid-cols-2">
          <AttachmentPreview fileName="ใบเสร็จ-7-11.jpg" mimeType="image/jpeg" sizeBytes={184_320} onRemove={() => {}} />
          <AttachmentPreview fileName="statement-sep.pdf" mimeType="application/pdf" sizeBytes={1_250_000} onOpen={() => {}} />
        </div>
      </Section>

      <Section title="States">
        <div className="grid gap-stack lg:grid-cols-2">
          <EmptyState icon={Inbox} title="ยังไม่มีรายการ" description="เริ่มบันทึกรายจ่ายแรกของคุณ" action={<PrimaryButton>บันทึกรายจ่าย</PrimaryButton>} />
          <ErrorState detail="Example: QuotaExceededError" onRetry={() => {}} />
          <Card className="py-0">
            <LoadingState variant="list" count={3} />
          </Card>
          <LoadingState variant="cards" count={2} />
        </div>
      </Section>

      <Section title="Card">
        <Card>
          <CardHeader>
            <CardTitle>หัวข้อการ์ด</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">ใช้การ์ดเมื่อช่วยจัดกลุ่มข้อมูลเท่านั้น</CardContent>
        </Card>
      </Section>
    </div>
  )
}
