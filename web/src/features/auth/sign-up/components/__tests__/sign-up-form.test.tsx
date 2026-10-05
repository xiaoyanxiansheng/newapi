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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter } from 'axios'
import { useState } from 'react'
import { Toaster } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SystemStatus } from '@/features/auth/types'
import { api } from '@/lib/api'
import { useAuthStore, type AuthBundle } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { SignUpForm } from '../sign-up-form'

const publicStatus: SystemStatus = {
  register_enabled: true,
  password_register_enabled: true,
}
const originalAdapter = api.defaults.adapter
const originalConfig = useSystemConfigStore.getState().config
const queryClients: QueryClient[] = []
const requests: Array<{ url: string; body: unknown; params: unknown }> = []
const authenticatedBundle: AuthBundle = {
  access_token: 'test-access',
  token_type: 'Bearer',
  access_expires_at: 1_900_000_000,
  user: { id: 1, username: 'example', role: 1 },
  session: {
    sid: 'test-session',
    current: true,
    login_method: 'wechat',
    ip: '127.0.0.1',
    user_agent: 'test',
    created_at: 1,
    last_active_at: 1,
    expires_at: 1_900_000_000,
  },
}

function renderForm(
  options: {
    status?: SystemStatus
    onRegistered?: () => void
    registrationResponse?: { success: boolean; message?: string }
    registrationFailure?: boolean
    pendingRegistration?: Promise<{ success: boolean; message?: string }>
    wechatResponse?: AuthBundle
  } = {}
) {
  const status = options.status ?? publicStatus
  const adapter: AxiosAdapter = async (config) => {
    requests.push({
      url: config.url ?? '',
      body:
        typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      params: config.params,
    })
    let data: unknown
    if (config.url === '/api/status') {
      data = { success: true, data: status }
    } else if (config.url === '/api/user/register') {
      if (options.registrationFailure) throw new Error('Network unavailable')
      data = options.pendingRegistration
        ? await options.pendingRegistration
        : (options.registrationResponse ?? { success: true })
    } else if (config.url === '/api/user/auth/logout') {
      data = { success: true }
    } else if (config.url === '/api/oauth/state') {
      data = { success: true, data: { flow_token: 'oauth-flow' } }
    } else if (config.url === '/api/oauth/wechat') {
      data = {
        success: true,
        data: options.wechatResponse ?? authenticatedBundle,
      }
    } else if (config.url === '/api/verification') {
      data = { success: true }
    } else {
      throw new Error(`Unexpected API request: ${config.url}`)
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config }
  }
  api.defaults.adapter = adapter
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(['status'], status)
  queryClients.push(queryClient)

  const rootRoute = createRootRoute()
  const formRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <SignUpForm onRegistered={options.onRegistered} />,
  })
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-in',
    component: () => <h2>Existing sign-in route</h2>,
  })
  const dashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard',
    component: () => <h2>Authenticated dashboard route</h2>,
  })
  const history = createMemoryHistory({ initialEntries: ['/'] })
  const router = createRouter({
    routeTree: rootRoute.addChildren([formRoute, signInRoute, dashboardRoute]),
    history,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  )
  return { router, queryClient }
}

async function submitValidPasswordRegistration() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('textbox', { name: 'Username' }))
  await user.paste('example')
  await user.click(screen.getByLabelText('Password', { exact: true }))
  await user.paste('securepass123')
  await user.click(screen.getByLabelText('Confirm password', { exact: true }))
  await user.paste('securepass123')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

beforeEach(() => {
  requests.length = 0
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.setState({ config: originalConfig, loading: false })
})

afterEach(() => {
  cleanup()
  queryClients.splice(0).forEach((client) => client.clear())
  api.defaults.adapter = originalAdapter
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.setState({ config: originalConfig, loading: true })
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

describe('SignUpForm password registration', () => {
  it('calls the optional completion callback after success without logging in or navigating', async () => {
    const onRegistered = vi.fn()
    const { router } = renderForm({ onRegistered })
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')

    await submitValidPasswordRegistration()

    await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText('Account created! Please sign in')
    ).toBeVisible()
    expect(router.state.location.pathname).toBe('/')
    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.accessToken).toBeNull()
    expect(
      requests.some((request) => request.url.includes('/api/user/login'))
    ).toBe(false)
    expect(
      storageWrite.mock.calls.some(([, value]) =>
        value.includes('securepass123')
      )
    ).toBe(false)
  })

  it('keeps the existing sign-in redirect when no callback is supplied', async () => {
    renderForm()

    await submitValidPasswordRegistration()

    expect(
      await screen.findByRole('heading', { name: 'Existing sign-in route' })
    ).toBeVisible()
    expect(useAuthStore.getState().auth.user).toBeNull()
  })

  it('allows the callback to replace the embedded form with login immediately after success', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(['status'], publicStatus)
    queryClients.push(queryClient)
    api.defaults.adapter = async (config) => ({
      data: { success: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
    function EmbeddedAuth() {
      const [registered, setRegistered] = useState(false)
      return registered ? (
        <h2>Sign in to continue</h2>
      ) : (
        <SignUpForm onRegistered={() => setRegistered(true)} />
      )
    }
    const rootRoute = createRootRoute({ component: EmbeddedAuth })
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    await submitValidPasswordRegistration()

    expect(
      await screen.findByRole('heading', { name: 'Sign in to continue' })
    ).toBeVisible()
    expect(router.state.location.pathname).toBe('/')
    expect(useAuthStore.getState().auth.user).toBeNull()
  })

  it('does not complete or redirect when the API rejects account creation', async () => {
    const onRegistered = vi.fn()
    const { router } = renderForm({
      onRegistered,
      registrationResponse: {
        success: false,
        message: 'Username already exists',
      },
    })

    await submitValidPasswordRegistration()

    expect(
      (await screen.findAllByText('Username already exists')).length
    ).toBeGreaterThan(0)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create account' })
      ).toBeEnabled()
    )
    expect(onRegistered).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/')
  })

  it('releases the pending state and keeps the form when the request fails', async () => {
    const onRegistered = vi.fn()
    renderForm({ onRegistered, registrationFailure: true })

    await submitValidPasswordRegistration()

    expect(await screen.findByText('Network unavailable')).toBeVisible()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create account' })
      ).toBeEnabled()
    )
    expect(onRegistered).not.toHaveBeenCalled()
  })

  it('disables repeat submission until a pending registration finishes', async () => {
    let resolveRegistration: (response: { success: boolean }) => void
    const pendingRegistration = new Promise<{ success: boolean }>((resolve) => {
      resolveRegistration = resolve
    })
    const onRegistered = vi.fn()
    renderForm({ onRegistered, pendingRegistration })

    await submitValidPasswordRegistration()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create account' })
      ).toBeDisabled()
    )
    expect(onRegistered).not.toHaveBeenCalled()
    await act(async () => resolveRegistration({ success: true }))
    await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1))
  })

  it('preserves referral and required email verification payloads', async () => {
    window.history.replaceState(null, '', '/?aff=partner-42')
    const onRegistered = vi.fn()
    renderForm({
      onRegistered,
      status: { ...publicStatus, email_verification: true },
    })
    const user = userEvent.setup({ delay: null })
    const username = await screen.findByLabelText('Username', { exact: true })
    const password = screen.getByLabelText('Password', { exact: true })
    const confirmPassword = screen.getByLabelText('Confirm password', {
      exact: true,
    })
    const email = screen.getByLabelText('Email (required for verification)', {
      exact: true,
    })
    const verificationCode = screen.getByPlaceholderText('Verification code')
    await user.click(username)
    await user.paste('example')
    await user.click(password)
    await user.paste('securepass123')
    await user.click(confirmPassword)
    await user.paste('securepass123')
    await user.click(email)
    await user.paste('example@example.com')
    await user.click(verificationCode)
    await user.paste('123456')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1))
    expect(
      requests.find((request) => request.url === '/api/user/register')?.body
    ).toMatchObject({
      username: 'example',
      password: 'securepass123',
      email: 'example@example.com',
      verification_code: '123456',
      aff_code: 'partner-42',
    })
    expect(localStorage.getItem('aff')).toBe('partner-42')
  })
})

describe('SignUpForm provider-only registration', () => {
  it('hides password, email verification and Turnstile while preserving legal consent and real OAuth', async () => {
    const onRegistered = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderForm({
      onRegistered,
      status: {
        register_enabled: true,
        password_register_enabled: false,
        github_oauth: true,
        github_client_id: 'github-public-client',
        email_verification: true,
        turnstile_check: true,
        turnstile_site_key: 'public-sitekey',
        user_agreement_enabled: true,
        privacy_policy_enabled: true,
      },
    })
    const github = await screen.findByRole('button', {
      name: /Continue with GitHub/,
    })
    expect(github).toBeDisabled()
    expect(
      screen.queryByRole('textbox', { name: 'Username' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('Password', { exact: true })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', {
        name: 'Email (required for verification)',
      })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Send code' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create account' })
    ).not.toBeInTheDocument()
    expect(
      document.querySelector('script[src*="challenges.cloudflare.com"]')
    ).toBeNull()
    expect(
      screen.getByRole('link', { name: 'User Agreement' })
    ).toHaveAttribute('href', '/user-agreement')
    expect(
      screen.getByRole('link', { name: 'Privacy Policy' })
    ).toHaveAttribute('href', '/privacy-policy')

    const user = userEvent.setup()
    await user.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(github).toBeEnabled())
    const form = github.closest('form')
    if (!form) throw new Error('Signup form not found')
    fireEvent.submit(form)
    expect(
      requests.some((request) => request.url === '/api/user/register')
    ).toBe(false)
    expect(
      screen.queryByText('Please enter your password')
    ).not.toBeInTheDocument()
    await user.click(github)

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        expect.stringContaining('https://github.com/login/oauth/authorize?'),
        '_self'
      )
    )
    expect(
      requests.find((request) => request.url === '/api/oauth/state')?.body
    ).toMatchObject({ provider: 'github', intent: 'login' })
    expect(onRegistered).not.toHaveBeenCalled()
  })

  it('keeps WeChat as a real authentication flow rather than invoking password completion', async () => {
    const onRegistered = vi.fn()
    renderForm({
      onRegistered,
      status: {
        register_enabled: true,
        password_register_enabled: false,
        wechat_login: true,
      },
    })
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: /Continue with WeChat/ })
    )
    const dialog = await screen.findByRole('dialog', { name: 'WeChat sign in' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Verification code' }),
      'wechat-code'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    expect(
      await screen.findByRole('heading', {
        name: 'Authenticated dashboard route',
      })
    ).toBeVisible()
    expect(useAuthStore.getState().auth.user?.username).toBe('example')
    expect(onRegistered).not.toHaveBeenCalled()
    expect(
      requests.find((request) => request.url === '/api/oauth/wechat')?.params
    ).toEqual({ code: 'wechat-code' })
  })

  it('does not render signup controls when global registration is closed', async () => {
    renderForm({
      status: {
        register_enabled: false,
        github_oauth: true,
        wechat_login: true,
      },
    })

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Create account' })
      ).not.toBeInTheDocument()
    )
    expect(
      screen.queryByRole('button', { name: /Continue with GitHub/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Continue with WeChat/ })
    ).not.toBeInTheDocument()
  })
})
