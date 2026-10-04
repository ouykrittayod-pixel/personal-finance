import { describe, expect, it } from 'vitest'
import { parseOAuthFragment } from './oauth-redirect'

describe('Google redirect sign-in answer', () => {
  it('reads the token from the fragment when the state matches', () => {
    expect(parseOAuthFragment('#state=s1&access_token=ya29.abc&token_type=Bearer&expires_in=3599&scope=openid%20https://www.googleapis.com/auth/drive.appdata', 's1')).toEqual({
      kind: 'token',
      accessToken: 'ya29.abc',
      expiresIn: 3599,
      scope: 'openid https://www.googleapis.com/auth/drive.appdata',
    })
  })

  it('reports a refusal', () => {
    expect(parseOAuthFragment('#error=access_denied&state=s1', 's1')).toEqual({ kind: 'error', error: 'access_denied' })
  })

  it('ignores answers this app did not ask for, and ordinary page fragments', () => {
    expect(parseOAuthFragment('#access_token=stolen&state=other', 's1')).toBeNull()
    expect(parseOAuthFragment('#access_token=x&state=s1', null)).toBeNull()
    expect(parseOAuthFragment('#/transactions?type=expense', 's1')).toBeNull()
    expect(parseOAuthFragment('', 's1')).toBeNull()
  })
})
