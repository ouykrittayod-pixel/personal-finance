/**
 * Categories are labels (not money). Users create, rename and archive them;
 * they are never deleted, because past transactions keep their category.
 */
import type { Category, CategoryKind, ID } from './entities'

export interface CategoryDraft {
  kind: CategoryKind
  name: string
  icon?: string
}

export type CategoryIssue = 'name_required' | 'name_too_long' | 'duplicate' | 'icon_too_long' | 'kind_change_not_allowed'

export const CATEGORY_NAME_MAX = 40

const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('th')

/** True when another open category of the same kind already has this name (case and spacing ignored). */
export function isDuplicateCategory(name: string, kind: CategoryKind, existing: readonly Category[], exceptId?: ID): boolean {
  const key = nameKey(name)
  return existing.some((c) => c.id !== exceptId && c.kind === kind && !c.archivedAt && nameKey(c.name) === key)
}

export function buildCategory(
  draft: CategoryDraft,
  existing: readonly Category[],
  meta: { id: ID; now: string; existing?: Category },
): { ok: true; category: Category } | { ok: false; issues: CategoryIssue[] } {
  const issues: CategoryIssue[] = []
  const name = draft.name.trim().replace(/\s+/g, ' ')
  const icon = draft.icon?.trim() || undefined
  if (!name) issues.push('name_required')
  else if (name.length > CATEGORY_NAME_MAX) issues.push('name_too_long')
  if (icon && [...icon].length > 4) issues.push('icon_too_long')
  if (meta.existing && meta.existing.kind !== draft.kind) issues.push('kind_change_not_allowed')
  if (name && isDuplicateCategory(name, draft.kind, existing, meta.existing?.id)) issues.push('duplicate')
  if (issues.length) return { ok: false, issues }

  const sameKind = existing.filter((c) => c.kind === draft.kind)
  const category: Category = {
    ...(meta.existing ?? {}),
    id: meta.existing?.id ?? meta.id,
    kind: draft.kind,
    name,
    sortOrder: meta.existing?.sortOrder ?? sameKind.reduce((max, c) => Math.max(max, c.sortOrder + 1), 0),
    createdAt: meta.existing?.createdAt ?? meta.now,
    updatedAt: meta.now,
  }
  if (icon) category.icon = icon
  else delete category.icon
  return { ok: true, category }
}
