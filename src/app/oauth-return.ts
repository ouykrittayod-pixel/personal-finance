/**
 * Imported first by main.tsx, before the router reads the address: a Google
 * sign-in that returned by redirect (home-screen app) leaves its token in the
 * URL fragment, which would otherwise be taken for a page path.
 */
import { storeRedirectToken } from '@/lib/google/auth'
import { captureOAuthRedirect } from '@/lib/google/oauth-redirect'

captureOAuthRedirect(storeRedirectToken)
