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
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter } from 'axios'
import type { ComponentProps } from 'react'
import { Toaster, toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { api, clearAuthentication } from '@/lib/api'
import { useAuthStore, type AuthBundle } from '@/stores/auth-store'

import type {
  ApiResponse,
  CustomOAuthProviderInfo,
  SystemStatus,
} from '../../types'
import { OAuthProviders } from '../oauth-providers'

// All identifiers and authorization state below are synthetic, nonsecret fixtures.
const googleProvider: CustomOAuthProviderInfo = {
  id: 101,
  name: 'Google',
  slug: 'google',
  icon: 'google',
  client_id: 'synthetic-google-client.apps.googleusercontent.com',
  authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  scopes: 'openid email profile',
}
const unknownProvider: CustomOAuthProviderInfo = {
  id: 102,
  name: 'Example Workspace',
  slug: 'synthetic-workspace',
  icon: 'synthetic-unknown-icon',
  client_id: 'synthetic-workspace-client',
  authorization_endpoint: 'https://identity.example.test/authorize',
  scopes: 'openid profile',
}
const oauthState = 'synthetic-state +/&=?#'
const existingSession: AuthBundle = {
  access_token: 'synthetic-access-token-not-a-credential',
  token_type: 'Bearer',
  access_expires_at: 2_100_000_000,
  user: { id: 101, username: 'synthetic-user', role: 1 },
  session: {
    sid: 'synthetic-session',
    current: true,
    login_method: 'password',
    ip: '192.0.2.1',
    user_agent: 'synthetic-test-browser',
    created_at: 1,
    last_active_at: 1,
    expires_at: 2_100_000_000,
  },
}

const originalAdapter = api.defaults.adapter
let originalAuthState: ReturnType<typeof useAuthStore.getState>
let originalRouter: AnyRouter | undefined
let router: AnyRouter | undefined
let queryClient: QueryClient
let history: ReturnType<typeof createMemoryHistory>
let network: ReturnType<typeof vi.fn<AxiosAdapter>>
let openWindow: ReturnType<typeof vi.fn<typeof window.open>>
let logoutResponse: Promise<ApiResponse>
let stateResponse: ApiResponse<string | { flow_token: string }>

async function renderProviders(
  props: ComponentProps<typeof OAuthProviders>
): Promise<void> {
  const rootRoute = createRootRoute({
    component: () => <OAuthProviders {...props} />,
  })
  router = createRouter({ routeTree: rootRoute, history })
  await router.load()

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  originalAuthState = useAuthStore.getState()
  originalRouter = window.__TSR_ROUTER__
  router = undefined
  clearAuthentication(false)
  localStorage.clear()
  sessionStorage.clear()
  // Exercise the real storage fallback without opening a cross-tab channel.
  vi.stubGlobal('BroadcastChannel', undefined)
  openWindow = vi.spyOn(window, 'open').mockReturnValue(null)
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  history = createMemoryHistory({ initialEntries: ['/'] })
  logoutResponse = Promise.resolve({ success: true, message: '' })
  stateResponse = {
    success: true,
    message: '',
    data: { flow_token: oauthState },
  }
  network = vi.fn<AxiosAdapter>(async (config) => {
    let data: ApiResponse
    if (config.method === 'post' && config.url === '/api/user/auth/logout') {
      data = await logoutResponse
    } else if (config.method === 'post' && config.url === '/api/oauth/state') {
      data = stateResponse
    } else {
      throw new Error(
        `Unexpected synthetic request: ${config.method} ${config.url}`
      )
    }
    return { config, data, status: 200, statusText: 'OK', headers: {} }
  })
  api.defaults.adapter = network
})

afterEach(async () => {
  toast.dismiss()
  cleanup()
  router?.cancelMatches()
  router = undefined
  if (originalRouter) {
    window.__TSR_ROUTER__ = originalRouter
  } else {
    delete window.__TSR_ROUTER__
  }
  await queryClient.cancelQueries()
  queryClient.clear()
  history.destroy()
  api.defaults.adapter = originalAdapter
  clearAuthentication(false)
  useAuthStore.setState(originalAuthState, true)
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Google custom OAuth login', () => {
  test.each<{ condition: string; status: SystemStatus | null }>([
    { condition: 'status is unavailable', status: null },
    { condition: 'status has no providers', status: {} },
    {
      condition: 'custom providers are empty',
      status: { custom_oauth_providers: [] },
    },
  ])(
    'does not add Google or a provider separator when $condition',
    async ({ status }) => {
      await renderProviders({ status })

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(screen.queryByText('Or continue with')).not.toBeInTheDocument()
      expect(network).not.toHaveBeenCalled()
      expect(openWindow).not.toHaveBeenCalled()
    }
  )

  test('a configured Google provider renders one accessible button with a decorative 16px logo', async () => {
    await renderProviders({
      status: { custom_oauth_providers: [googleProvider] },
    })

    const button = screen.getByRole('button', { name: 'Continue with Google' })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(button).toHaveAccessibleName('Continue with Google')
    expect(button).toBeEnabled()
    const icon = button.querySelector('span[aria-hidden="true"] svg')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAttribute('width', '16')
    expect(icon).toHaveAttribute('height', '16')
    const colors = new Set(
      Array.from(icon?.querySelectorAll('[fill]') ?? [], (segment) =>
        segment.getAttribute('fill')
      )
    )
    expect(colors.size).toBeGreaterThanOrEqual(4)
    expect(colors.has('currentColor')).toBe(false)
  })

  test('an unknown custom provider remains usable by keyboard alongside Google', async () => {
    const user = userEvent.setup()
    await renderProviders({
      status: { custom_oauth_providers: [googleProvider, unknownProvider] },
    })

    const googleButton = screen.getByRole('button', {
      name: 'Continue with Google',
    })
    const workspaceButton = screen.getByRole('button', {
      name: 'Continue with Example Workspace',
    })
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(workspaceButton).toBeEnabled()
    expect(workspaceButton.querySelector('svg')).not.toBeInTheDocument()
    await user.tab()
    expect(googleButton).toHaveFocus()
    await user.tab()
    expect(workspaceButton).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(openWindow).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(network.mock.calls[1][0].data))).toEqual({
      provider: 'synthetic-workspace',
      intent: 'login',
    })
    const url = new URL(String(openWindow.mock.calls[0][0]))
    expect(url.origin).toBe('https://identity.example.test')
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${window.location.origin}/oauth/synthetic-workspace`
    )
    expect(openWindow.mock.calls[0][1]).toBe('_self')
  })

  test('an unknown icon does not render a Google logo even when the provider is named Google', async () => {
    await renderProviders({
      status: {
        custom_oauth_providers: [
          { ...googleProvider, icon: 'synthetic-unknown-icon' },
        ],
      },
    })

    const button = screen.getByRole('button', { name: 'Continue with Google' })
    expect(button).toBeEnabled()
    expect(button.querySelector('svg')).not.toBeInTheDocument()
  })

  test('global disabling prevents every configured custom provider from starting login', async () => {
    const user = userEvent.setup()
    await renderProviders({
      disabled: true,
      status: { custom_oauth_providers: [googleProvider, unknownProvider] },
    })

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
      await user.click(button)
    }
    expect(network).not.toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
  })

  test('clicking Google waits for logout before creating a login state and opening the encoded authorization URL', async () => {
    const user = userEvent.setup()
    useAuthStore.getState().auth.setBundle(existingSession)
    localStorage.setItem('aff', 'synthetic-affiliate')
    let finishLogout: (value: ApiResponse) => void = () => {
      throw new Error('Synthetic logout boundary was not initialized')
    }
    logoutResponse = new Promise<ApiResponse>((resolve) => {
      finishLogout = resolve
    })
    await renderProviders({
      status: { custom_oauth_providers: [googleProvider] },
    })
    const button = screen.getByRole('button', { name: 'Continue with Google' })

    await user.click(button)

    await waitFor(() => expect(network).toHaveBeenCalledTimes(1))
    const logoutRequest = network.mock.calls[0][0]
    expect(logoutRequest).toMatchObject({
      method: 'post',
      url: '/api/user/auth/logout',
    })
    expect(logoutRequest.headers.get('X-Auth-Session')).toBe(
      'synthetic-session'
    )
    expect(button).toBeDisabled()
    expect(openWindow).not.toHaveBeenCalled()
    await user.click(button)
    expect(network).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishLogout({ success: true, message: '' })
      await logoutResponse
    })

    await waitFor(() => expect(openWindow).toHaveBeenCalledTimes(1))
    expect(network).toHaveBeenCalledTimes(2)
    const stateRequest = network.mock.calls[1][0]
    expect(stateRequest).toMatchObject({
      method: 'post',
      url: '/api/oauth/state',
    })
    expect(JSON.parse(String(stateRequest.data))).toEqual({
      provider: 'google',
      intent: 'login',
      aff: 'synthetic-affiliate',
    })
    expect(stateRequest.headers.get('Authorization')).toBeUndefined()
    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.session).toBeNull()
    const openedUrl = String(openWindow.mock.calls[0][0])
    const url = new URL(openedUrl)
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.pathname).toBe('/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'synthetic-google-client.apps.googleusercontent.com',
      redirect_uri: `${window.location.origin}/oauth/google`,
      response_type: 'code',
      state: 'synthetic-state +/&=?#',
      scope: 'openid email profile',
    })
    expect(openedUrl).toContain('state=synthetic-state+%2B%2F%26%3D%3F%23')
    expect(openWindow.mock.calls[0][1]).toBe('_self')
  })

  test('state initialization failure shows an error without opening Google and allows a successful retry', async () => {
    const user = userEvent.setup()
    stateResponse = {
      success: false,
      message: 'Synthetic OAuth state initialization failure',
    }
    await renderProviders({
      status: { custom_oauth_providers: [googleProvider] },
    })
    const button = screen.getByRole('button', { name: 'Continue with Google' })

    await user.click(button)

    expect(
      await screen.findByText('Failed to start Google login')
    ).toBeVisible()
    await waitFor(() => expect(button).toBeEnabled())
    expect(openWindow).not.toHaveBeenCalled()
    expect(network.mock.calls.map(([request]) => request.url)).toEqual([
      '/api/user/auth/logout',
      '/api/oauth/state',
    ])

    stateResponse = {
      success: true,
      message: '',
      data: { flow_token: 'synthetic-retry-state' },
    }
    await user.click(button)

    await waitFor(() => expect(openWindow).toHaveBeenCalledTimes(1))
    expect(network.mock.calls.map(([request]) => request.url)).toEqual([
      '/api/user/auth/logout',
      '/api/oauth/state',
      '/api/user/auth/logout',
      '/api/oauth/state',
    ])
    const url = new URL(String(openWindow.mock.calls[0][0]))
    expect(url.searchParams.get('state')).toBe('synthetic-retry-state')
    expect(openWindow.mock.calls[0][1]).toBe('_self')
    await waitFor(() => expect(button).toBeEnabled())
  })
})
