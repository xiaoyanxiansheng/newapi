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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { SignIn } from '../sign-in'
import { SignUp } from '../sign-up'
import type { SystemStatus } from '../types'

const originalAdapter = api.defaults.adapter
const originalSystemConfig = useSystemConfigStore.getState()
const clients: QueryClient[] = []

function renderAuthPage(options: {
  path: '/sign-in' | '/sign-up'
  status?: SystemStatus
  statusRequest?: Promise<SystemStatus | null>
}) {
  api.defaults.adapter = async (config) => {
    if (config.url !== '/api/status') {
      throw new Error(`Unexpected request: ${config.url}`)
    }
    const data = options.statusRequest
      ? await options.statusRequest
      : options.status
    return {
      data: { success: true, data },
      config,
      headers: {},
      status: 200,
      statusText: 'OK',
    }
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (options.status) client.setQueryData(['status'], options.status)
  clients.push(client)

  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '(auth)' })
  const signIn = createRoute({
    getParentRoute: () => auth,
    path: 'sign-in',
    component: SignIn,
    validateSearch: (search: Record<string, unknown>) => ({
      redirect:
        typeof search.redirect === 'string' ? search.redirect : undefined,
    }),
  })
  const signUp = createRoute({
    getParentRoute: () => auth,
    path: 'sign-up',
    component: SignUp,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([signIn, signUp])]),
    history: createMemoryHistory({ initialEntries: [options.path] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { client, router }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.setState({
    config: originalSystemConfig.config,
    loadedLogoUrl: originalSystemConfig.loadedLogoUrl,
    loading: false,
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  api.defaults.adapter = originalAdapter
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.setState({
    config: originalSystemConfig.config,
    loadedLogoUrl: originalSystemConfig.loadedLogoUrl,
    loading: originalSystemConfig.loading,
  })
  localStorage.clear()
  sessionStorage.clear()
})

describe('standalone registration availability', () => {
  it('shows public signup on sign-in even when self-use presentation is enabled', async () => {
    renderAuthPage({
      path: '/sign-in',
      status: {
        self_use_mode_enabled: true,
        register_enabled: true,
        password_register_enabled: true,
      },
    })

    expect(
      await screen.findByRole('link', { name: 'Sign up' })
    ).toHaveAttribute('href', '/sign-up')
    expect(
      screen.getByRole('textbox', { name: 'Username or Email' })
    ).toBeVisible()
  })

  it.each<SystemStatus>([
    { register_enabled: false },
    { register_enabled: true, password_register_enabled: false },
    {
      register_enabled: true,
      password_register_enabled: false,
      telegram_oauth: true,
    },
  ])(
    'hides the sign-in signup link when account creation is unavailable (%j)',
    async (status) => {
      renderAuthPage({ path: '/sign-in', status })

      await screen.findByRole('heading', { name: 'Sign in' })
      expect(
        screen.queryByRole('link', { name: 'Sign up' })
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('textbox', { name: 'Username or Email' })
      ).toBeVisible()
    }
  )

  it('shows provider-only signup on sign-in independently of password registration', async () => {
    renderAuthPage({
      path: '/sign-in',
      status: {
        register_enabled: true,
        password_register_enabled: false,
        wechat_login: true,
      },
    })

    expect(await screen.findByRole('link', { name: 'Sign up' })).toBeVisible()
  })

  it('shows loading instead of granting signup while status is unresolved', async () => {
    let resolveStatus: (status: SystemStatus | null) => void
    const statusRequest = new Promise<SystemStatus | null>((resolve) => {
      resolveStatus = resolve
    })
    renderAuthPage({ path: '/sign-up', statusRequest })

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Loading registration options...'
    )
    expect(
      screen.queryByRole('button', { name: 'Create account' })
    ).not.toBeInTheDocument()
    await act(async () => resolveStatus({ register_enabled: false }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Registration is currently unavailable'
      )
    )
  })

  it('keeps registration unavailable when status fetching fails', async () => {
    let rejectStatus: (error: Error) => void
    const statusRequest = new Promise<SystemStatus | null>(
      (_resolve, reject) => {
        rejectStatus = reject
      }
    )
    renderAuthPage({ path: '/sign-up', statusRequest })
    await screen.findByRole('status')

    await act(async () => rejectStatus(new Error('Status unavailable')))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Registration is currently unavailable'
      )
    )
    expect(
      screen.queryByRole('button', { name: 'Create account' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in'
    )
  })

  it.each<SystemStatus>([
    { register_enabled: false, github_oauth: true },
    {
      register_enabled: true,
      password_register_enabled: false,
      oauth_register_enabled: false,
      wechat_login: true,
    },
    { register_enabled: true, password_register_enabled: false },
  ])(
    'shows a closed signup state while preserving the sign-in route (%j)',
    async (status) => {
      renderAuthPage({ path: '/sign-up', status })

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Registration is currently unavailable'
      )
      expect(
        screen.queryByRole('textbox', { name: 'Username' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Create account' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Continue with/ })
      ).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
        'href',
        '/sign-in'
      )
    }
  )

  it('keeps the provider-only direct page legal-gated without password fields', async () => {
    renderAuthPage({
      path: '/sign-up',
      status: {
        register_enabled: true,
        password_register_enabled: false,
        wechat_login: true,
        user_agreement_enabled: true,
      },
    })
    const provider = await screen.findByRole('button', {
      name: /Continue with WeChat/,
    })
    expect(provider).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Create account' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('Password', { exact: true })
    ).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('checkbox'))

    await waitFor(() => expect(provider).toBeEnabled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
