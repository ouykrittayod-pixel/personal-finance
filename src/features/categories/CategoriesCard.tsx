import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { useToast } from '@/components/feedback/toast-context'
import { Tabs, TabsList, TabsTrigger } from '@/components/navigation/Tabs'
import { Dialog } from '@/components/overlays/Dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CategoryValidationError, categoriesRepository } from '@/db/repositories'
import type { Category, CategoryKind } from '@/domain/entities'
import type { CategoryIssue } from '@/domain/categories'
import { STARTER_EXPENSE_CATEGORIES, STARTER_INCOME_CATEGORIES } from '@/features/expenses/quick-expense/starter-categories'
import { newId } from '@/lib/ids'
import { t } from '@/lib/i18n'

type FormState = { mode: 'create'; kind: CategoryKind } | { mode: 'edit'; category: Category }

/**
 * Manage categories (Settings): add, rename, archive / restore. Never deletes —
 * past transactions keep their category. Duplicate names are refused.
 */
export function CategoriesCard() {
  const toast = useToast()
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [form, setForm] = useState<FormState | null>(null)
  const categories = useLiveQuery(() => categoriesRepository.listAll(), [])
  const ofKind = (categories ?? []).filter((c) => c.kind === kind)
  const open = ofKind.filter((c) => !c.archivedAt)
  const archived = ofKind.filter((c) => c.archivedAt)
  const now = () => new Date().toISOString()

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action()
      toast.show({ message: success, tone: 'success' })
    } catch (error) {
      toast.show({ message: error instanceof CategoryValidationError ? t(`categories.error.${error.issues[0]!}`) : t('categories.error.save'), tone: 'error' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('categories.title')}</h2>
        </CardTitle>
        <CardDescription>{t('categories.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Tabs value={kind} onValueChange={(v) => setKind(v as CategoryKind)}>
          <TabsList aria-label={t('categories.title')}>
            <TabsTrigger value="expense" className="min-h-touch md:min-h-8">
              {t('categories.tab.expense')}
            </TabsTrigger>
            <TabsTrigger value="income" className="min-h-touch md:min-h-8">
              {t('categories.tab.income')}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {categories && open.length === 0 && (
          <div className="flex flex-col items-start gap-2 text-sm">
            <p className="text-muted-foreground">{t('categories.empty')}</p>
            <Button
              variant="outline"
              size="touch"
              onClick={() =>
                void run(
                  () =>
                    categoriesRepository.createStarterSet(kind, kind === 'income' ? STARTER_INCOME_CATEGORIES : STARTER_EXPENSE_CATEGORIES, {
                      now: now(),
                    }),
                  t('categories.saved'),
                )
              }
            >
              {t('categories.starter')}
            </Button>
          </div>
        )}

        {open.length > 0 && (
          <ul aria-label={t(kind === 'income' ? 'categories.tab.income' : 'categories.tab.expense')} className="flex flex-col divide-y">
            {open.map((category) => (
              <li key={category.id} className="flex items-center gap-2 py-1">
                <span aria-hidden="true" className="w-7 text-center text-lg">
                  {category.icon ?? '•'}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{category.name}</span>
                <Button
                  variant="ghost"
                  size="icon-touch"
                  aria-label={t('categories.edit', { name: category.name })}
                  onClick={() => setForm({ mode: 'edit', category })}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-touch"
                  aria-label={t('categories.archive', { name: category.name })}
                  onClick={() => void run(() => categoriesRepository.archive(category.id, { now: now() }), t('categories.archivedToast'))}
                >
                  <Archive aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Button size="touch" variant="outline" className="self-start" onClick={() => setForm({ mode: 'create', kind })}>
          <Plus aria-hidden="true" />
          {t('categories.add')}
        </Button>

        {archived.length > 0 && (
          <details className="text-sm">
            <summary className="min-h-touch cursor-pointer py-2 text-muted-foreground md:min-h-8">
              {t('categories.archived')} ({archived.length})
            </summary>
            <ul className="flex flex-col divide-y">
              {archived.map((category) => (
                <li key={category.id} className="flex items-center gap-2 py-1 text-muted-foreground">
                  <span aria-hidden="true" className="w-7 text-center">
                    {category.icon ?? '•'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{category.name}</span>
                  <Button
                    variant="ghost"
                    size="icon-touch"
                    aria-label={t('categories.restore', { name: category.name })}
                    onClick={() => void run(() => categoriesRepository.restore(category.id, { now: now() }), t('categories.restoredToast'))}
                  >
                    <ArchiveRestore aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
      {form && <CategoryFormDialog form={form} onClose={() => setForm(null)} />}
    </Card>
  )
}

function CategoryFormDialog({ form, onClose }: { form: FormState; onClose: () => void }) {
  const toast = useToast()
  const id = useId()
  const existing = form.mode === 'edit' ? form.category : undefined
  const kind = existing?.kind ?? (form.mode === 'create' ? form.kind : 'expense')
  const [name, setName] = useState(existing?.name ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? '')
  const [error, setError] = useState<CategoryIssue | 'save' | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    const now = new Date().toISOString()
    const draft = { kind, name, icon }
    try {
      if (existing) await categoriesRepository.update(existing.id, draft, { now })
      else await categoriesRepository.create(draft, { id: newId(), now })
      toast.show({ message: t('categories.saved'), tone: 'success' })
      onClose()
    } catch (caught) {
      setError(caught instanceof CategoryValidationError ? caught.issues[0]! : 'save')
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={existing ? t('categories.form.editTitle') : t('categories.form.createTitle')}
      description={t(kind === 'income' ? 'categories.tab.income' : 'categories.tab.expense')}
      footer={
        <>
          <Button type="button" variant="outline" size="touch" onClick={onClose}>
            {t('categories.form.cancel')}
          </Button>
          <Button type="submit" form={id} size="touch" disabled={saving}>
            {t('categories.form.save')}
          </Button>
        </>
      }
    >
      <form id={id} onSubmit={(event) => void save(event)} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-name`}>{t('categories.form.name')}</Label>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={60}
            autoFocus
            aria-invalid={error && error !== 'icon_too_long' ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-icon`}>{t('categories.form.icon')}</Label>
          <Input id={`${id}-icon`} value={icon} maxLength={8} className="w-24" onChange={(event) => setIcon(event.target.value)} />
        </div>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
            {t(error === 'save' ? 'categories.error.save' : `categories.error.${error}`)}
          </p>
        )}
      </form>
    </Dialog>
  )
}
