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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import type { CustomOAuthProvider } from '../../types'
import { ProviderFormDialog } from '../provider-form-dialog'

const GOOGLE_POLICY = {
  logic: 'and',
  conditions: [{ field: 'email_verified', op: 'eq', value: true }],
}

const EDIT_PROVIDER: CustomOAuthProvider = {
  id: 12,
  name: 'Google',
  slug: 'google',
  icon: 'google',
  enabled: false,
  client_id: 'test-client.apps.googleusercontent.com',
  client_secret: 'synthetic-secret-must-not-be-prefilled',
  authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_endpoint: 'https://oauth2.googleapis.com/token',
  user_info_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
  scopes: 'openid email profile',
  user_id_field: 'sub',
  username_field: '',
  display_name_field: 'name',
  email_field: 'email',
  well_known: 'https://accounts.google.com/.well-known/openid-configuration',
  auth_style: 1,
  access_policy: JSON.stringify(GOOGLE_POLICY),
  access_denied_message: '',
}

let queryClient: QueryClient

function renderDialog(provider?: CustomOAuthProvider) {
  const onOpenChange = vi.fn()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ProviderFormDialog
        open
        onOpenChange={onOpenChange}
        serverAddress='https://login.example.com'
        provider={provider}
      />
    </QueryClientProvider>
  )
  return { ...view, onOpenChange }
}

async function selectPreset(
  user: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await user.click(screen.getByRole('combobox', { name: 'Preset Template' }))
  await user.click(await screen.findByRole('option', { name }))
}

async function fillField(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  value: string
) {
  await user.click(field)
  await user.paste(value)
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('custom OAuth provider creation', { timeout: 20000 }, () => {
  it('selecting Google immediately fills absolute endpoints and verified-email defaults without credentials or discovery', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true } })
    const user = userEvent.setup()
    renderDialog()

    await selectPreset(user, 'Google')

    expect(
      screen.queryByRole('textbox', { name: 'Base URL' })
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Provider Name')).toHaveValue('Google')
    expect(screen.getByLabelText('Slug')).toHaveValue('google')
    expect(screen.getByLabelText('Icon')).toHaveValue('google')
    expect(screen.getByLabelText('Well-Known URL')).toHaveValue(
      'https://accounts.google.com/.well-known/openid-configuration'
    )
    expect(screen.getByLabelText('Authorization Endpoint')).toHaveValue(
      'https://accounts.google.com/o/oauth2/v2/auth'
    )
    expect(screen.getByLabelText('Token Endpoint')).toHaveValue(
      'https://oauth2.googleapis.com/token'
    )
    expect(screen.getByLabelText('User Info Endpoint')).toHaveValue(
      'https://openidconnect.googleapis.com/v1/userinfo'
    )
    expect(screen.getByLabelText('Scopes')).toHaveValue('openid email profile')
    expect(screen.getByLabelText('User ID Field')).toHaveValue('sub')
    expect(screen.getByLabelText('Username Field')).toHaveValue('')
    expect(screen.getByLabelText('Display Name Field')).toHaveValue('name')
    expect(screen.getByLabelText('Email Field')).toHaveValue('email')
    expect(
      screen.getByRole('combobox', { name: 'Auth Style' })
    ).toHaveTextContent('Params (in body)')
    expect(
      JSON.parse(
        (screen.getByLabelText('Access Policy (JSON)') as HTMLTextAreaElement)
          .value
      )
    ).toEqual(GOOGLE_POLICY)
    expect(screen.getByRole('switch', { name: 'Enabled' })).not.toBeChecked()
    expect(screen.getByLabelText('Client ID')).toHaveValue('')
    expect(screen.getByLabelText('Client Secret')).toHaveValue('')
    expect(
      screen.getByText('https://login.example.com/oauth/google')
    ).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('switching away from Google clears Google-only settings and endpoints while preserving entered credentials', async () => {
    const user = userEvent.setup()
    renderDialog()
    await fillField(
      user,
      screen.getByLabelText('Client ID'),
      'admin-entered-client'
    )
    await fillField(
      user,
      screen.getByLabelText('Client Secret'),
      'admin-entered-synthetic-secret'
    )
    await selectPreset(user, 'Google')
    await fillField(
      user,
      screen.getByLabelText('Access Denied Message'),
      'Google-specific restriction'
    )

    await selectPreset(user, 'GitLab')

    expect(screen.getByLabelText('Base URL')).toHaveValue('')
    expect(screen.getByLabelText('Authorization Endpoint')).toHaveValue('')
    expect(screen.getByLabelText('Token Endpoint')).toHaveValue('')
    expect(screen.getByLabelText('User Info Endpoint')).toHaveValue('')
    expect(screen.getByLabelText('Well-Known URL')).toHaveValue('')
    expect(
      screen.getByRole('combobox', { name: 'Auth Style' })
    ).toHaveTextContent('Auto Detect')
    expect(screen.getByLabelText('Access Policy (JSON)')).toHaveValue('')
    expect(screen.getByLabelText('Access Denied Message')).toHaveValue('')
    expect(screen.getByLabelText('Username Field')).toHaveValue('username')
    expect(screen.getByRole('switch', { name: 'Enabled' })).toBeChecked()
    expect(screen.getByLabelText('Client ID')).toHaveValue(
      'admin-entered-client'
    )
    expect(screen.getByLabelText('Client Secret')).toHaveValue(
      'admin-entered-synthetic-secret'
    )
  })

  it('self-hosted presets retain their base URL across Google and still normalize trailing slashes', async () => {
    const user = userEvent.setup()
    renderDialog()
    await selectPreset(user, 'GitLab')
    await fillField(
      user,
      screen.getByLabelText('Base URL'),
      'https://git.example.com///'
    )
    expect(screen.getByLabelText('Authorization Endpoint')).toHaveValue(
      'https://git.example.com/oauth/authorize'
    )

    await selectPreset(user, 'Google')
    expect(screen.getByLabelText('Authorization Endpoint')).toHaveValue(
      'https://accounts.google.com/o/oauth2/v2/auth'
    )
    await selectPreset(user, 'Gitea')

    expect(screen.getByLabelText('Base URL')).toHaveValue(
      'https://git.example.com///'
    )
    expect(screen.getByLabelText('Authorization Endpoint')).toHaveValue(
      'https://git.example.com/login/oauth/authorize'
    )
    expect(screen.getByLabelText('Token Endpoint')).toHaveValue(
      'https://git.example.com/login/oauth/access_token'
    )
    expect(screen.getByLabelText('User Info Endpoint')).toHaveValue(
      'https://git.example.com/api/v1/user'
    )
  })

  it('reopening creation resets preset and base URL along with all credential fields', async () => {
    const user = userEvent.setup()
    const view = renderDialog()
    await selectPreset(user, 'GitLab')
    await fillField(
      user,
      screen.getByLabelText('Base URL'),
      'https://git.example.com'
    )
    await selectPreset(user, 'Google')
    await fillField(
      user,
      screen.getByLabelText('Client ID'),
      'synthetic-client'
    )
    await fillField(
      user,
      screen.getByLabelText('Client Secret'),
      'synthetic-secret'
    )

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ProviderFormDialog
          open={false}
          onOpenChange={view.onOpenChange}
          serverAddress='https://login.example.com'
        />
      </QueryClientProvider>
    )
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ProviderFormDialog
          open
          onOpenChange={view.onOpenChange}
          serverAddress='https://login.example.com'
        />
      </QueryClientProvider>
    )

    expect(
      screen.getByRole('combobox', { name: 'Preset Template' })
    ).toHaveTextContent('Select a preset...')
    expect(screen.getByLabelText('Base URL')).toHaveValue('')
    expect(screen.getByLabelText('Authorization Endpoint')).toHaveValue('')
    expect(screen.getByLabelText('Client ID')).toHaveValue('')
    expect(screen.getByLabelText('Client Secret')).toHaveValue('')
  })

  it('Google creation rejects a blank secret and then submits disabled with only admin-entered credentials', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true } })
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog()
    await selectPreset(user, 'Google')
    await fillField(
      user,
      screen.getByLabelText('Client ID'),
      'test-client.apps.googleusercontent.com'
    )
    await user.click(screen.getByRole('button', { name: 'Create Provider' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Client Secret')).toHaveAttribute(
        'aria-invalid',
        'true'
      )
    )
    expect(post).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()

    await fillField(
      user,
      screen.getByLabelText('Client Secret'),
      'synthetic-admin-entered-secret'
    )
    await user.click(screen.getByRole('button', { name: 'Create Provider' }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/custom-oauth-provider/',
        expect.objectContaining({
          slug: 'google',
          enabled: false,
          client_id: 'test-client.apps.googleusercontent.com',
          client_secret: 'synthetic-admin-entered-secret',
          auth_style: 1,
          username_field: '',
        })
      )
    )
    const payload = post.mock.calls[0][1] as CustomOAuthProvider
    expect(JSON.parse(payload.access_policy)).toEqual(GOOGLE_POLICY)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Google creation becomes enabled only after the administrator explicitly toggles Enabled', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true } })
    const user = userEvent.setup()
    renderDialog()
    await selectPreset(user, 'Google')
    await fillField(
      user,
      screen.getByLabelText('Client ID'),
      'test-client.apps.googleusercontent.com'
    )
    await fillField(
      user,
      screen.getByLabelText('Client Secret'),
      'synthetic-admin-entered-secret'
    )
    const enabled = screen.getByRole('switch', { name: 'Enabled' })
    expect(enabled).not.toBeChecked()

    await user.click(enabled)
    await user.click(screen.getByRole('button', { name: 'Create Provider' }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/custom-oauth-provider/',
        expect.objectContaining({ enabled: true })
      )
    )
  })
})

describe('custom OAuth provider editing', () => {
  it('editing leaves the secret empty and sends an empty replacement to preserve the stored secret', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog(EDIT_PROVIDER)
    expect(
      screen.queryByRole('combobox', { name: 'Preset Template' })
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Client Secret')).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Update Provider' }))

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/custom-oauth-provider/12',
        expect.objectContaining({
          client_secret: '',
          client_id: EDIT_PROVIDER.client_id,
          enabled: false,
        })
      )
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
