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
import { readFileSync } from 'node:fs'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { ThemeProvider } from '@/context/theme-provider'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { AuthenticatedLayout } from '../components/authenticated-layout'
import { SYSTEM_SETTINGS_VIEW } from '../config/system-settings.config'

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
  document.documentElement.classList.remove('light', 'dark')
})
async function mountConsole(
  role: number = ROLE.USER,
  disabled = false,
  initialPath = '/market'
) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  useAuthStore.getState().auth.setUser({ id: 1, username: 'Example', role })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['status'], {
    system_name: 'hwjai',
    SidebarModulesAdmin: disabled
      ? JSON.stringify({ console: { enabled: true, token: false } })
      : '',
  })
  client.setQueryData(['notice'], { success: true, data: '' })
  const root = createRootRoute({
    component: () => (
      <AuthenticatedLayout>
        <Outlet />
      </AuthenticatedLayout>
    ),
  })
  const routes = [
    '/market',
    '/keys',
    '/profile',
    '/dashboard/$section',
    '/usage-logs/$section',
    '/channels',
    '/system-settings/$category/$section',
  ].map((path) =>
    createRoute({
      getParentRoute: () => root,
      path,
      component: () => <main id='main'>Content</main>,
    })
  )
  router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider defaultTheme='light'>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  )
  return await screen.findByRole('navigation', { name: 'Main navigation' })
}
test('replaces the sidebar with five top links and moves the current-page state when switching', async () => {
  const nav = await mountConsole()
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent)
  ).toEqual(['Workspace', 'Models', 'API Access', 'Usage', 'Account'])
  expect(within(nav).getByRole('link', { name: 'Models' })).toHaveAttribute(
    'aria-current',
    'page'
  )
  expect(
    screen.queryByRole('button', { name: 'Toggle Sidebar' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'More navigation' })
  ).not.toBeInTheDocument()
  await userEvent.click(within(nav).getByRole('link', { name: 'Usage' }))
  expect(await screen.findByRole('link', { name: 'Usage' })).toHaveAttribute(
    'aria-current',
    'page'
  )
  expect(screen.getByRole('link', { name: 'Models' })).not.toHaveAttribute(
    'aria-current'
  )
  await router.navigate({
    to: '/usage-logs/$section',
    params: { section: 'common' },
  })
  expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute(
    'aria-current',
    'page'
  )
})
test('honors disabled modules in top navigation and retains administrator destinations in a menu', async () => {
  const nav = await mountConsole(ROLE.ADMIN, true)
  expect(
    within(nav).queryByRole('link', { name: 'API Access' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'More navigation' }))
  expect(
    await screen.findByRole('menuitem', { name: 'Upstream channels' })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('menuitem', { name: 'Channels' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('menuitem', { name: 'Market Listings' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('menuitem', { name: 'System Settings' })
  ).toBeInTheDocument()
})

test('opens billing from settings categories and makes registration quota and check-in reachable', async () => {
  await mountConsole(
    ROLE.SUPER_ADMIN,
    false,
    '/system-settings/site/system-info'
  )
  const categories = screen.getByRole('navigation', {
    name: 'Settings categories',
  })
  expect(
    within(categories)
      .getAllByRole('link')
      .map((link) => link.textContent)
  ).toEqual([
    'Site & Branding',
    'Authentication',
    'Billing & Payment',
    'Models & Routing',
    'Security & Limits',
    'Console Content',
    'Operations',
  ])
  await userEvent.click(
    within(categories).getByRole('link', { name: 'Billing & Payment' })
  )
  const sections = await screen.findByRole('navigation', {
    name: 'Section navigation',
  })
  expect(
    within(sections).getByRole('link', { name: 'Quota Settings' })
  ).toHaveAttribute('href', '/system-settings/billing/quota')
  expect(
    within(sections).getByRole('link', { name: 'Quota Settings' })
  ).toHaveAttribute('aria-current', 'page')
  await userEvent.click(
    within(sections).getByRole('link', { name: 'Check-in Rewards' })
  )
  expect(router.state.location.pathname).toBe(
    '/system-settings/billing/checkin'
  )
  expect(
    within(sections).getByRole('link', { name: 'Check-in Rewards' })
  ).toHaveAttribute('aria-current', 'page')
  expect(
    within(sections).getByRole('link', { name: 'Quota Settings' })
  ).not.toHaveAttribute('aria-current')
  expect(
    within(categories).getByRole('link', { name: 'Billing & Payment' })
  ).toHaveAttribute('aria-current', 'page')
})

test('deep-linked settings select the category and allow keyboard access to its sections', async () => {
  await mountConsole(
    ROLE.SUPER_ADMIN,
    false,
    '/system-settings/billing/checkin'
  )
  const categories = screen.getByRole('navigation', {
    name: 'Settings categories',
  })
  expect(
    within(categories).getByRole('link', { name: 'Billing & Payment' })
  ).toHaveAttribute('aria-current', 'page')
  const sections = screen.getByRole('navigation', {
    name: 'Section navigation',
  })
  const quota = within(sections).getByRole('link', { name: 'Quota Settings' })
  quota.focus()
  await userEvent.keyboard('{Enter}')
  expect(router.state.location.pathname).toBe('/system-settings/billing/quota')
  expect(quota).toHaveAttribute('aria-current', 'page')
})

test('ordinary accounts do not display administrator settings navigation even at a settings URL', async () => {
  await mountConsole(ROLE.USER, false, '/system-settings/billing/checkin')
  expect(
    screen.queryByRole('navigation', { name: 'Settings categories' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('navigation', { name: 'Section navigation' })
  ).not.toBeInTheDocument()
})

test('switching across all settings categories preserves every registered administrator section', async () => {
  await mountConsole(
    ROLE.SUPER_ADMIN,
    false,
    '/system-settings/site/system-info'
  )
  const categories = screen.getByRole('navigation', {
    name: 'Settings categories',
  })
  const groups = SYSTEM_SETTINGS_VIEW.getNavGroups(
    ((key: string) => key) as Parameters<
      typeof SYSTEM_SETTINGS_VIEW.getNavGroups
    >[0]
  )
  for (const category of groups.flatMap((group) => group.items)) {
    if (!category.items) continue
    await userEvent.click(
      within(categories).getByRole('link', { name: category.title })
    )
    const sections = screen.getByRole('navigation', {
      name: 'Section navigation',
    })
    expect(
      within(sections)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
    ).toEqual(category.items.map((item) => item.url))
    expect(
      within(categories).getByRole('link', { name: category.title })
    ).toHaveAttribute('aria-current', 'page')
  }
})

test('settings navigation keeps each row horizontally scrollable within a narrow screen', async () => {
  await mountConsole(
    ROLE.SUPER_ADMIN,
    false,
    '/system-settings/billing/checkin'
  )
  const css = readFileSync('src/styles/index.css', 'utf8')
  const scrollRule = css.match(/\.hwjai-context-navigation\s*\{([^}]+)\}/)?.[1]
  expect(scrollRule).toMatch(/overflow-x:\s*auto/)
  for (const name of ['Settings categories', 'Section navigation']) {
    const nav = screen.getByRole('navigation', { name })
    expect(nav.closest('.hwjai-context-navigation')).not.toBeNull()
  }
  expect(css).toMatch(
    /\.hwjai-settings-navigation \.hwjai-context-navigation\s*\{[^}]*max-width:\s*100%/
  )
})
