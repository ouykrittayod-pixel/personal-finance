/**
 * Tabs for switching views within a page (e.g. รายวัน / รายเดือน).
 * Radix tabs: arrow-key navigation, correct tab/tabpanel roles.
 * The list stretches full-width on phones so each tab is an easy target.
 */
import type { ComponentProps } from 'react'
import { Tabs as TabsRoot, TabsContent, TabsList as TabsListBase, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export function Tabs(props: ComponentProps<typeof TabsRoot>) {
  return <TabsRoot {...props} />
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsListBase>) {
  return <TabsListBase className={cn('w-full sm:w-fit', className)} {...props} />
}

export { TabsContent, TabsTrigger }
