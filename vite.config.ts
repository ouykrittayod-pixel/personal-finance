/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Public base path.
 * - Local dev / preview: "/"
 * - GitHub Pages project site: "/<repo-name>/" (set by the deploy workflow via BASE_PATH)
 */
function resolveBase(): string {
  const raw = process.env.BASE_PATH?.trim()
  if (!raw) return '/'
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

const base = resolveBase()

/** App version (package.json), written into backups. */
const appVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

/**
 * Long-lived vendor chunks: libraries that rarely change get their own files,
 * so an app update doesn't make users re-download them (and the service
 * worker re-precache them). Feature-only libraries (e.g. Recharts) stay in
 * their lazy route chunks.
 */
const VENDOR_CHUNKS: ReadonlyArray<[name: string, test: RegExp]> = [
  ['vendor-react', /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/],
  ['vendor-dexie', /[\\/]node_modules[\\/]dexie[\\/]/],
]

function vendorChunk(moduleId: string): string | null {
  return VENDOR_CHUNKS.find(([, test]) => test.test(moduleId))?.[0] ?? null
}

/**
 * Every VITE_ variable is compiled into the browser bundle. Refuse the build if
 * one looks like a secret (client secret, password, private key, token…).
 */
function assertNoSecretsInClientEnv(mode: string) {
  for (const name of Object.keys(loadEnv(mode, process.cwd(), 'VITE_'))) {
    if (/SECRET|PASSWORD|PASSPHRASE|PRIVATE|TOKEN|JWT|SERVICE_ROLE/i.test(name))
      throw new Error(`${name}: secrets must never be VITE_ variables — they would be bundled into the browser.`)
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  assertNoSecretsInClientEnv(mode)
  return {
    base,
    define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion) },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: {
          name: 'การเงินส่วนตัว',
          short_name: 'การเงิน',
          description: 'บันทึกรายรับรายจ่ายส่วนตัว ข้อมูลเก็บในเครื่องของคุณเท่านั้น',
          lang: 'th',
          theme_color: '#0f766e',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        includeManifestIcons: false,
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
          // Hash routing: every route is served by index.html.
          navigateFallback: `${base}index.html`,
          cleanupOutdatedCaches: true,
        },
        devOptions: { enabled: false },
      }),
    ],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: { groups: [{ name: vendorChunk }] },
        },
      },
    },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
      globals: true,
      // Plain Node by default (fast); component tests opt into jsdom with a @vitest-environment docblock.
      environment: 'node',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  }
})
