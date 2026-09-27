import { createHashRouter } from 'react-router'
import { routes } from './routes'

/**
 * Hash routing ("#/expenses") so deep links and refreshes work on GitHub Pages,
 * which cannot rewrite unknown paths to index.html.
 */
export const router = createHashRouter(routes)

export { NAV_ITEMS, type NavItem } from './nav-items'
