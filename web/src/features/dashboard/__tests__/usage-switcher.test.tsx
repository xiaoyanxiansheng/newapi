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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { UsageSwitcher } from '../components/usage-switcher'

let client: QueryClient
let router: ReturnType<typeof createRouter>
const originalAuth = useAuthStore.getState()
const originalRouter = window.__TSR_ROUTER__
afterEach(async () => {
  cleanup()
  router?.cancelMatches()
  await client?.cancelQueries()
  client?.clear()
  useAuthStore.setState(originalAuth, true)
  window.__TSR_ROUTER__ = originalRouter
  localStorage.clear()
})

test('navigates from usage overview to trends and request history inside the unified usage navigation', async () => {
  useAuthStore.getState().auth.reset()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['status'], {})
  const root = createRootRoute({ component: Outlet })
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/$section',
    validateSearch: (search) => ({ view: search.view as string | undefined }),
    component: () => <UsageSwitcher active='summary' />,
  })
  const logs = createRoute({
    getParentRoute: () => root,
    path: '/usage-logs/$section',
    component: () => <UsageSwitcher active='requests' />,
  })
  router = createRouter({
    routeTree: root.addChildren([dashboard, logs]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/models'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  expect(
    await screen.findByRole('link', { name: 'Usage overview' })
  ).toHaveAttribute('aria-current', 'page')
  await userEvent.click(screen.getByRole('link', { name: 'Trends' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ view: 'trends' })
  )
  await userEvent.click(screen.getByRole('link', { name: 'Request history' }))
  expect(
    await screen.findByRole('link', { name: 'Request history' })
  ).toHaveAttribute('aria-current', 'page')
  expect(router.state.location.pathname).toBe('/usage-logs/common')
})
