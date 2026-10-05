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
import type { SystemStatus } from '@/features/auth/types'

export interface RegistrationCapabilities {
  registrationEnabled: boolean
  passwordRegistrationEnabled: boolean
  oauthRegistrationEnabled: boolean
  canRegister: boolean
}

export function getRegistrationCapabilities(
  status: SystemStatus | null
): RegistrationCapabilities {
  if (!status || status.success === false) {
    return {
      registrationEnabled: false,
      passwordRegistrationEnabled: false,
      oauthRegistrationEnabled: false,
      canRegister: false,
    }
  }

  // Older resolved status responses omit these flags; the backend defaults
  // global/password registration to enabled. Unresolved status never does.
  const registrationEnabled =
    (status.register_enabled ?? status.data?.register_enabled ?? true) !== false
  const passwordRegistrationEnabled =
    registrationEnabled &&
    (status.password_register_enabled ??
      status.data?.password_register_enabled ??
      true) !== false
  const hasOAuthRegistrationProvider = Boolean(
    (status.github_oauth ?? status.data?.github_oauth) ||
    (status.discord_oauth ?? status.data?.discord_oauth) ||
    (status.oidc_enabled ?? status.data?.oidc_enabled) ||
    (status.linuxdo_oauth ?? status.data?.linuxdo_oauth) ||
    (status.wechat_login ?? status.data?.wechat_login) ||
    (status.custom_oauth_providers ?? status.data?.custom_oauth_providers ?? [])
      .length > 0
  )
  // Telegram only signs in existing bound users; it cannot create accounts.
  // Current backends gate OAuth/WeChat signup on global registration alone.
  const oauthRegistrationEnabled =
    registrationEnabled &&
    (status.oauth_register_enabled ??
      status.data?.oauth_register_enabled ??
      true) !== false &&
    hasOAuthRegistrationProvider

  return {
    registrationEnabled,
    passwordRegistrationEnabled,
    oauthRegistrationEnabled,
    canRegister: passwordRegistrationEnabled || oauthRegistrationEnabled,
  }
}
