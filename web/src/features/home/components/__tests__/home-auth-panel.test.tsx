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
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { SystemStatus } from '@/features/auth/types'
import { api } from '@/lib/api'
import { useAuthStore, type AuthBundle } from '@/stores/auth-store'

import { HomeAuthPanel } from '../home-auth-panel'

let queryClient: QueryClient
const openRegistration: SystemStatus = {
  register_enabled: true,
  password_register_enabled: true,
  password_login_enabled: true,
  self_use_mode_enabled: true,
}
const bundle: AuthBundle = {
  access_token: 'isolated-test-token',
  token_type: 'Bearer',
  access_expires_at: 2000000000,
  user: { id: 3, username: 'builder', display_name: 'Builder', role: 1 },
  session: {
    sid: 'test-session',
    current: true,
    login_method: 'password',
    ip: '127.0.0.1',
    user_agent: 'test',
    created_at: 1,
    last_active_at: 1,
    expires_at: 2000000000,
  },
}

async function renderPanel(status: SystemStatus | null = openRegistration) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (status) queryClient.setQueryData(['status'], status)
  const rootRoute = createRootRoute({ component: Outlet })
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomeAuthPanel,
  })
  const dashboard = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard',
    component: () => <h1>Dashboard destination</h1>,
  })
  const otp = createRoute({
    getParentRoute: () => rootRoute,
    path: '/otp',
    component: () => <h1>Two-factor destination</h1>,
  })
  const signIn = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-in',
    component: () => <h1>Standalone login destination</h1>,
  })
  const forgot = createRoute({
    getParentRoute: () => rootRoute,
    path: '/forgot-password',
    component: () => <h1>Password recovery destination</h1>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([home, dashboard, otp, signIn, forgot]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { router, user: userEvent.setup() }
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  useAuthStore.getState().auth.reset()
})

afterEach(() => {
  queryClient?.clear()
  useAuthStore.getState().auth.reset()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('homepage account access', () => {
  test('shows registration even in self-use mode and mounts only the active form', async () => {
    const { user } = await renderPanel()
    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByLabelText('Username or Email')).toBeVisible()
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Create account' }))
    expect(screen.getByRole('tab', { name: 'Create account' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.queryByLabelText('Username or Email')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toBeVisible()
  })

  test('successful registration returns to inline login without storing passwords or navigating away', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true } })
    const { user, router } = await renderPanel()
    await user.click(screen.getByRole('tab', { name: 'Create account' }))
    await user.click(screen.getByLabelText('Username'))
    await user.paste('builder')
    await user.click(screen.getByLabelText('Password', { exact: true }))
    await user.paste('test-password')
    await user.click(screen.getByLabelText('Confirm password'))
    await user.paste('test-password')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    )
    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveFocus()
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue('')
    expect(localStorage.getItem('password')).toBeNull()
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/api/user/register'),
      expect.objectContaining({ username: 'builder' }),
      expect.objectContaining({ params: { turnstile: '' } })
    )
  })

  test('keyboard arrow navigation selects the registration tab', async () => {
    const { user } = await renderPanel()
    screen.getByRole('tab', { name: 'Sign in' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Create account' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Create account' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  test('closing registration removes the active signup form and restores login focus', async () => {
    const { user } = await renderPanel()
    await user.click(screen.getByRole('tab', { name: 'Create account' }))
    await act(async () =>
      queryClient.setQueryData(['status'], {
        ...openRegistration,
        register_enabled: false,
      })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('tab', { name: 'Create account' })
      ).not.toBeInTheDocument()
    )
    expect(screen.getByLabelText('Username or Email')).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveFocus()
  })

  test('OAuth-only registration offers the configured provider without password fields', async () => {
    const { user } = await renderPanel({
      ...openRegistration,
      password_register_enabled: false,
      github_oauth: true,
      github_client_id: 'public-client',
    })
    await user.click(screen.getByRole('tab', { name: 'Create account' }))
    expect(
      screen.getByRole('button', { name: /Continue with GitHub/ })
    ).toBeVisible()
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create account' })
    ).not.toBeInTheDocument()
  })

  test('signed-in users see console and key shortcuts rather than credentials', async () => {
    useAuthStore.getState().auth.setBundle(bundle)
    await renderPanel()
    expect(
      screen.getByRole('button', { name: 'Go to Dashboard' })
    ).toHaveAttribute('href', '/dashboard')
    expect(
      screen.getByRole('button', { name: 'Manage API keys' })
    ).toHaveAttribute('href', '/keys')
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  test('password login applies the real bundle and opens the dashboard', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: bundle },
    })
    const { user } = await renderPanel()
    await user.type(screen.getByLabelText('Username or Email'), 'builder')
    await user.type(screen.getByLabelText('Password'), 'test-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Dashboard destination' })
    expect(useAuthStore.getState().auth.user?.id).toBe(3)
  })

  test('two-factor login saves the flow token and opens the existing OTP flow', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: { require_2fa: true, flow_token: 'test-2fa-flow' },
      },
    })
    const { user } = await renderPanel()
    await user.type(screen.getByLabelText('Username or Email'), 'builder')
    await user.type(screen.getByLabelText('Password'), 'test-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Two-factor destination' })
    expect(useAuthStore.getState().auth.pending2FAFlowToken).toBe(
      'test-2fa-flow'
    )
    expect(useAuthStore.getState().auth.user).toBeNull()
  })

  test('required legal consent keeps the password login action disabled until accepted', async () => {
    const { user } = await renderPanel({
      ...openRegistration,
      user_agreement_enabled: true,
    })
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  test('pending status shows loading and no enabled registration form', async () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => undefined))
    await renderPanel(null)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading sign-in options...'
    )
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  test('failed status shows retry rather than assuming registration permissions', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'))
    await renderPanel(null)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in options are unavailable'
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })
})
