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
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter } from 'axios'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { Profile } from '..'
import { AccountSwitcher } from '../components/account-switcher'
import type { UserProfile } from '../types'

let queryClient: QueryClient
let router: ReturnType<typeof createRouter>
const originalAuth = useAuthStore.getState()
const originalRouter = window.__TSR_ROUTER__
const originalAdapter = api.defaults.adapter
async function setup(
  sidebar = '',
  role: number = ROLE.USER,
  openPreferences = false
) {
  useAuthStore.getState().auth.reset()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'builder', role })
  const userProfile: UserProfile = {
    id: 1,
    username: 'builder',
    display_name: 'Example builder',
    role,
    group: 'default',
    quota: 1000,
    used_quota: 0,
    request_count: 0,
    status: 1,
    aff_count: 0,
    aff_quota: 0,
    aff_history_quota: 0,
    created_time: 0,
  }
  api.defaults.adapter = vi.fn<AxiosAdapter>(async (config) => {
    if (config.method !== 'get' || config.url !== '/api/user/self') {
      throw new Error(`Unexpected request: ${config.method} ${config.url}`)
    }
    return {
      config,
      data: { success: true, data: userProfile },
      status: 200,
      statusText: 'OK',
      headers: {},
    }
  })
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(['status'], { SidebarModulesAdmin: sidebar })
  const root = createRootRoute({ component: Outlet })
  const profile = createRoute({
    getParentRoute: () => root,
    path: '/profile',
    component: () =>
      openPreferences ? (
        <Profile section='preferences' />
      ) : (
        <AccountSwitcher active='profile' />
      ),
    validateSearch: (search) => ({
      section: search.section as string | undefined,
    }),
  })
  router = createRouter({
    routeTree: root.addChildren([profile]),
    history: createMemoryHistory({
      initialEntries: [
        openPreferences
          ? '/profile?section=preferences'
          : '/profile?section=profile',
      ],
    }),
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  await router.load()
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('navigation', { name: 'Account center' })
}
afterEach(async () => {
  cleanup()
  router?.cancelMatches()
  await queryClient?.cancelQueries()
  queryClient?.clear()
  useAuthStore.setState(originalAuth, true)
  api.defaults.adapter = originalAdapter
  window.__TSR_ROUTER__ = originalRouter
  localStorage.clear()
})

test('keeps all account views in one route and switches billing without a document reload', async () => {
  await setup()
  expect(
    screen.getByRole('link', { name: 'Profile and security' })
  ).toHaveAttribute('aria-current', 'page')
  await userEvent.click(
    screen.getByRole('link', { name: 'Balance and billing' })
  )
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ section: 'wallet' })
  )
  expect(router.state.location.pathname).toBe('/profile')
})

test('hides the billing view when the administrator disables wallet display', async () => {
  await setup(
    JSON.stringify({
      personal: { enabled: true, personal: true, topup: false },
    })
  )
  expect(
    screen.queryByRole('link', { name: 'Balance and billing' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Preferences' })
  ).not.toBeInTheDocument()
})

test('ordinary users opening the preferences view see account overview without preference controls', async () => {
  await setup('', ROLE.USER, true)
  await screen.findByText('Example builder')
  expect(
    screen.queryByRole('link', { name: 'Preferences' })
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Language Preferences')).not.toBeInTheDocument()
  expect(screen.queryByText('Chat Area')).not.toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Account overview' })
  ).toHaveAttribute('aria-current', 'page')
  expect(
    screen.getByRole('link', { name: 'Balance and billing' })
  ).toBeVisible()
  expect(
    screen.getByRole('link', { name: 'Profile and security' })
  ).toBeVisible()
})

test.each([ROLE.ADMIN, ROLE.SUPER_ADMIN])(
  'administrator role %s retains the preferences view and its controls',
  async (role) => {
    await setup('', role, true)
    expect(screen.getByRole('link', { name: 'Preferences' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(await screen.findByText('Language Preferences')).toBeVisible()
    expect(await screen.findByText('Chat Area')).toBeVisible()
  }
)
