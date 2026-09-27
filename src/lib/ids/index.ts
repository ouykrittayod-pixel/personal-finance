import type { ID } from '@/domain/entities'

/** New random entity id (UUID v4). Requires a secure context (https or localhost). */
export function newId(): ID {
  return crypto.randomUUID()
}
