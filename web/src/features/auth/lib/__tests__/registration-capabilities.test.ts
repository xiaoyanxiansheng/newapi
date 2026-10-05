/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, it } from 'vitest'

import type { SystemStatus } from '@/features/auth/types'

import { getRegistrationCapabilities } from '../registration-capabilities'

const customProvider = {
  id: 1,
  name: 'Example',
  slug: 'example',
  icon: '',
  client_id: 'public-client',
  authorization_endpoint: 'https://example.com/authorize',
  scopes: 'openid',
}

describe('getRegistrationCapabilities', () => {
  it.each([null, { success: false }])(
    'denies registration while status is missing or unsuccessful (%j)',
    (status) => {
      expect(getRegistrationCapabilities(status)).toEqual({
        registrationEnabled: false,
        passwordRegistrationEnabled: false,
        oauthRegistrationEnabled: false,
        canRegister: false,
      })
    }
  )

  it('keeps verified enabled-by-default password registration for resolved legacy status', () => {
    expect(getRegistrationCapabilities({ version: 'legacy' })).toEqual({
      registrationEnabled: true,
      passwordRegistrationEnabled: true,
      oauthRegistrationEnabled: false,
      canRegister: true,
    })
  })

  it('blocks every signup method when global registration is explicitly closed', () => {
    expect(
      getRegistrationCapabilities({
        register_enabled: false,
        password_register_enabled: true,
        github_oauth: true,
        wechat_login: true,
        oauth_register_enabled: true,
      })
    ).toEqual({
      registrationEnabled: false,
      passwordRegistrationEnabled: false,
      oauthRegistrationEnabled: false,
      canRegister: false,
    })
  })

  it.each<SystemStatus>([
    { github_oauth: true },
    { discord_oauth: true },
    { oidc_enabled: true },
    { linuxdo_oauth: true },
    { wechat_login: true },
    { custom_oauth_providers: [customProvider] },
  ])(
    'preserves available provider-only signup with absent legacy OAuth flag (%j)',
    (provider) => {
      expect(
        getRegistrationCapabilities({
          register_enabled: true,
          password_register_enabled: false,
          ...provider,
        })
      ).toEqual({
        registrationEnabled: true,
        passwordRegistrationEnabled: false,
        oauthRegistrationEnabled: true,
        canRegister: true,
      })
    }
  )

  it('honors explicitly disabled OAuth registration without blocking password signup', () => {
    expect(
      getRegistrationCapabilities({
        register_enabled: true,
        github_oauth: true,
        oauth_register_enabled: false,
      })
    ).toEqual({
      registrationEnabled: true,
      passwordRegistrationEnabled: true,
      oauthRegistrationEnabled: false,
      canRegister: true,
    })
  })

  it.each<SystemStatus>([
    {},
    { passkey_login: true },
    { telegram_oauth: true, telegram_bot_name: 'example_bot' },
    { custom_oauth_providers: [] },
    { github_oauth: true, oauth_register_enabled: false },
  ])(
    'reports no signup methods when passwords and all account-creating providers are unavailable (%j)',
    (provider) => {
      expect(
        getRegistrationCapabilities({
          register_enabled: true,
          password_register_enabled: false,
          ...provider,
        })
      ).toEqual({
        registrationEnabled: true,
        passwordRegistrationEnabled: false,
        oauthRegistrationEnabled: false,
        canRegister: false,
      })
    }
  )

  it('does not let self-use presentation disable explicitly public registration', () => {
    expect(
      getRegistrationCapabilities({
        register_enabled: true,
        password_register_enabled: true,
        self_use_mode_enabled: true,
      }).canRegister
    ).toBe(true)
  })

  it('reads legacy nested status flags and provider methods', () => {
    expect(
      getRegistrationCapabilities({
        success: true,
        data: {
          register_enabled: true,
          password_register_enabled: false,
          wechat_login: true,
        },
      })
    ).toEqual({
      registrationEnabled: true,
      passwordRegistrationEnabled: false,
      oauthRegistrationEnabled: true,
      canRegister: true,
    })
  })

  it('preserves explicit flat false flags over nested legacy defaults', () => {
    expect(
      getRegistrationCapabilities({
        register_enabled: false,
        data: { register_enabled: true, github_oauth: true },
      }).canRegister
    ).toBe(false)
  })
})
