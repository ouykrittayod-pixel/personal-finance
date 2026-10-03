import { useEffect, useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WeakPassphraseError, WrongPassphraseError } from '@/lib/crypto/keyring'
import { t } from '@/lib/i18n'
import { cloudConfig } from '@/lib/supabase/config'
import { cloudSession, keyVault, startCloud, useCloudSession, useKeyVault } from './cloud'

/**
 * Settings: optional cloud sign-in (email one-time code / magic link) and this
 * device's encryption key. Nothing here is needed for local use, and nothing
 * here uploads finance data (Phase 19 has no sync).
 */
export function CloudCard() {
  const session = useCloudSession()
  useEffect(() => {
    void startCloud()
  }, [])

  return (
    <Card data-testid="cloud-card">
      <CardHeader>
        <CardTitle>
          <h2>{t('cloud.title')}</h2>
        </CardTitle>
        <CardDescription>{t('cloud.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {cloudConfig.status !== 'configured' ? (
          <p className="text-muted-foreground" role="status">
            {t(cloudConfig.status === 'missing' ? 'cloud.unconfigured' : 'cloud.invalidConfig')}
          </p>
        ) : (
          <>
            <SignIn />
            {session.status === 'signed_in' && <EncryptionKey />}
          </>
        )}
        <p className="text-muted-foreground">{t('cloud.sync.off')}</p>
      </CardContent>
    </Card>
  )
}

function ErrorLine({ code }: { code: string | null }) {
  if (!code) return null
  return (
    <p role="alert" className="text-destructive">
      {t(`cloud.error.${code}` as 'cloud.error.offline')}
    </p>
  )
}

function SignIn() {
  const state = useCloudSession()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const emailId = useId()
  const codeId = useId()

  if (state.status === 'loading') return <p className="text-muted-foreground">{t('cloud.loading')}</p>

  if (state.status === 'signed_in')
    return (
      <div className="flex flex-col gap-2">
        <p>{t('cloud.signedInAs', { email: state.user?.email ?? '—' })}</p>
        <Button variant="outline" size="touch" className="self-start" disabled={state.busy} onClick={() => void cloudSession.signOut()}>
          {t('cloud.signOut')}
        </Button>
        <p className="text-muted-foreground">{t('cloud.signOutHint')}</p>
      </div>
    )

  if (state.status === 'code_sent') {
    const submit = (event: FormEvent) => {
      event.preventDefault()
      void cloudSession.verifyCode(code)
    }
    return (
      <form className="flex flex-col gap-2" onSubmit={submit}>
        <p>{t('cloud.codeSent', { email: state.email ?? '' })}</p>
        <Label htmlFor={codeId}>{t('cloud.code')}</Label>
        <Input id={codeId} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
        <ErrorLine code={state.error} />
        <div className="flex gap-2">
          <Button type="submit" size="touch" disabled={state.busy}>
            {t('cloud.verify')}
          </Button>
          <Button type="button" variant="outline" size="touch" onClick={() => cloudSession.cancelCode()}>
            {t('cloud.cancel')}
          </Button>
        </div>
      </form>
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void cloudSession.requestCode(email)
  }
  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <Label htmlFor={emailId}>{t('cloud.email')}</Label>
      <Input id={emailId} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <ErrorLine code={state.error} />
      <div className="flex gap-2">
        <Button type="submit" size="touch" className="self-start" disabled={state.busy}>
          {t('cloud.sendCode')}
        </Button>
        {state.status === 'error' && (
          <Button type="button" variant="outline" size="touch" onClick={() => void startCloud()}>
            {t('cloud.retry')}
          </Button>
        )}
      </div>
    </form>
  )
}

function EncryptionKey() {
  const vault = useKeyVault()
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const passId = useId()
  const confirmId = useId()

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setPassphrase('')
      setConfirm('')
    } catch (e) {
      setError(t(e instanceof WeakPassphraseError ? 'cloud.key.weak' : e instanceof WrongPassphraseError ? 'cloud.key.wrong' : 'cloud.key.failed'))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (vault.status === 'none') {
      if (passphrase !== confirm) return setError(t('cloud.key.mismatch'))
      void run(() => keyVault.setup(passphrase))
    } else void run(() => keyVault.unlock(passphrase))
  }

  return (
    <section className="flex flex-col gap-2 border-t pt-4">
      <h3 className="font-medium">{t('cloud.key.title')}</h3>
      <p className="text-muted-foreground">{t('cloud.key.explain')}</p>
      {vault.status === 'unlocked' ? (
        <>
          <p data-testid="key-status">{t('cloud.key.unlocked')}</p>
          <Button variant="outline" size="touch" className="self-start" onClick={() => keyVault.lock()}>
            {t('cloud.key.lock')}
          </Button>
        </>
      ) : vault.status === 'unknown' ? null : (
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <p data-testid="key-status">{vault.status === 'none' ? t('cloud.key.warning') : t('cloud.key.locked')}</p>
          <Label htmlFor={passId}>{t('cloud.key.passphrase')}</Label>
          <Input id={passId} type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          {vault.status === 'none' && (
            <>
              <Label htmlFor={confirmId}>{t('cloud.key.confirm')}</Label>
              <Input id={confirmId} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="touch" className="self-start" disabled={busy}>
            {t(vault.status === 'none' ? 'cloud.key.create' : 'cloud.key.unlock')}
          </Button>
        </form>
      )}
    </section>
  )
}
