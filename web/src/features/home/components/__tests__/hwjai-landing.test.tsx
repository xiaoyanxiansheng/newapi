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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter } from 'axios'
import { createInstance, type i18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ThemeProvider } from '@/context/theme-provider'
import type { SystemStatus } from '@/features/auth/types'
import { Home } from '@/features/home'
import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore } from '@/stores/notification-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

const originalAdapter = api.defaults.adapter
const originalAuth = useAuthStore.getState()
const originalSystemConfig = useSystemConfigStore.getState()
const originalNotifications = useNotificationStore.getState()
const openRegistration: SystemStatus = {
  register_enabled: true,
  password_register_enabled: true,
  password_login_enabled: true,
}

let queryClient: QueryClient
let history: ReturnType<typeof createMemoryHistory>
let router: ReturnType<typeof createRouter> | undefined
let originalRouter: typeof window.__TSR_ROUTER__
let translations: i18n
let originalRootClass: string
let originalBodyOverflow: string

function MarketDestination() {
  return <h1>Model marketplace destination</h1>
}

async function renderHome(status: SystemStatus = openRegistration) {
  queryClient.setQueryData(['status'], status)
  const root = createRootRoute({ component: Outlet })
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: Home,
  })
  const market = createRoute({
    getParentRoute: () => root,
    path: '/market',
    component: MarketDestination,
  })
  router = createRouter({
    routeTree: root.addChildren([home, market]),
    history,
  })
  await router.load()
  render(
    <I18nextProvider i18n={translations}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          defaultTheme='light'
          storageKey='home-landing-test-theme'
        >
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
  await screen.findByRole('heading', { level: 1, name: /Simpler AI access/ })
  return { user: userEvent.setup() }
}

beforeEach(async () => {
  originalRouter = window.__TSR_ROUTER__
  originalRootClass = document.documentElement.className
  originalBodyOverflow = document.body.style.overflow
  router = undefined
  localStorage.clear()
  sessionStorage.clear()
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.setState({
    config: {
      systemName: 'Configured site',
      logo: '/configured-logo.png',
      footerHtml: undefined,
      demoSiteEnabled: false,
      currency: { ...DEFAULT_CURRENCY_CONFIG },
    },
    loading: false,
    loadedLogoUrl: '/configured-logo.png',
  })
  useNotificationStore.setState({
    lastReadNotice: '',
    readAnnouncementKeys: [],
    closedUntilDate: null,
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  translations = createInstance()
  await translations.init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'zhCN'],
    load: 'currentOnly',
    nsSeparator: false,
    resources: { en, zhCN },
    interpolation: { escapeValue: false },
  })
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(['notice'], { success: true, data: '' })
  history = createMemoryHistory({ initialEntries: ['/'] })
  api.defaults.adapter = vi.fn<AxiosAdapter>(async (config) => {
    if (config.method !== 'get' || config.url !== '/api/home_page_content') {
      throw new Error(`Unexpected request: ${config.method} ${config.url}`)
    }
    return {
      config,
      data: { success: true, data: '' },
      status: 200,
      statusText: 'OK',
      headers: {},
    }
  })
})

afterEach(async () => {
  cleanup()
  router?.cancelMatches()
  history.destroy()
  if (originalRouter) {
    window.__TSR_ROUTER__ = originalRouter
  } else {
    delete window.__TSR_ROUTER__
  }
  await queryClient.cancelQueries()
  queryClient.clear()
  api.defaults.adapter = originalAdapter
  useAuthStore.setState(originalAuth, true)
  useSystemConfigStore.setState(originalSystemConfig, true)
  useNotificationStore.setState(originalNotifications, true)
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.className = originalRootClass
  document.body.style.overflow = originalBodyOverflow
  vi.restoreAllMocks()
})

describe('hwjai landing composition', () => {
  test('empty configured content selects direct account access instead of the old demo and retains project attribution', async () => {
    localStorage.setItem(
      'home_page_content',
      '<h1>Previously configured home</h1>'
    )
    await renderHome()

    const main = screen.getByRole('main')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(main).toHaveAttribute('id', 'main-content')
    const account = within(main).getByRole('tabpanel', { name: 'Sign in' })
    expect(within(account).getByLabelText('Username or Email')).toBeVisible()
    expect(within(account).getByLabelText('Password')).toBeVisible()
    expect(
      within(account).getByRole('button', { name: 'Sign in' })
    ).toBeEnabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.queryByText('upstream services integrated')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('model billing support')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Chat' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('/v1/chat/completions')).not.toBeInTheDocument()
    expect(localStorage.getItem('home_page_content')).toBeNull()
    expect(router?.state.location.pathname).toBe('/')

    expect(
      within(screen.getByRole('banner')).getByRole('link', { name: 'hwjai' })
    ).toHaveAttribute('href', '/')
    const attribution = within(screen.getByRole('contentinfo')).getByRole(
      'link',
      { name: 'New API' }
    )
    expect(attribution).toHaveAttribute(
      'href',
      'https://github.com/QuantumNous/new-api'
    )
    expect(attribution).toHaveAttribute('rel', 'noopener noreferrer')
    expect(
      screen.getByRole('link', { name: 'Read the integration guide' })
    ).toHaveAttribute('href', 'https://docs.newapi.pro')
  })

  test('mobile and desktop language controls translate the landing and real account form without losing input', async () => {
    const { user } = await renderHome()
    await user.type(screen.getByLabelText('Username or Email'), 'builder')
    const languageControls = within(screen.getByRole('banner')).getAllByRole(
      'button',
      { name: 'Change language' }
    )
    // jsdom does not apply responsive CSS: exercise both real header controls,
    // without claiming viewport visibility or pixel layout.
    expect(languageControls).toHaveLength(2)
    await user.click(languageControls[1])
    expect(languageControls[1]).toHaveAttribute('aria-expanded', 'true')
    await user.click(await screen.findByRole('menuitem', { name: '简体中文' }))

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /让 AI 接入更简单，.*让调用成本更清晰。/,
      })
    ).toBeVisible()
    expect(
      screen.getByRole('region', { name: 'AI 接入与账户登录' })
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: '登录 hwjai' })).toBeVisible()
    expect(
      screen.getByRole('tablist', { name: '账户登录与注册' })
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '创建账户' })).toBeInTheDocument()
    expect(screen.getByLabelText('用户名或电子邮件')).toHaveValue('builder')
    expect(screen.getByLabelText('密码')).toBeVisible()
    expect(screen.getByRole('link', { name: '阅读接入指南' })).toBeVisible()
    expect(screen.getByRole('link', { name: '探索模型' })).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Sign in to hwjai' })
    ).not.toBeInTheDocument()

    await user.click(
      within(screen.getByRole('banner')).getAllByRole('button', {
        name: '更改语言',
      })[0]
    )
    await user.click(await screen.findByRole('menuitem', { name: 'English' }))
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /Simpler AI access/,
      })
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Sign in to hwjai' })
    ).toBeVisible()
    expect(screen.getByLabelText('Username or Email')).toHaveValue('builder')
    expect(
      screen.getByRole('link', { name: 'Read the integration guide' })
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: '登录 hwjai' })
    ).not.toBeInTheDocument()
    expect(router?.state.location.pathname).toBe('/')
  })

  test('configured integration guidance stays external and model exploration navigates through the real router', async () => {
    const { user } = await renderHome({
      ...openRegistration,
      docs_link: 'https://guide.example.test/integration',
    })
    const guide = screen.getByRole('link', {
      name: 'Read the integration guide',
    })
    expect(guide).toHaveAttribute(
      'href',
      'https://guide.example.test/integration'
    )
    expect(guide).toHaveAttribute('target', '_blank')
    expect(guide).toHaveAttribute('rel', 'noopener noreferrer')

    const models = screen.getByRole('link', { name: 'Explore models' })
    expect(models).toHaveAttribute('href', '/market')
    await user.click(models)
    expect(
      await screen.findByRole('heading', {
        name: 'Model marketplace destination',
      })
    ).toBeVisible()
    expect(router?.state.location.pathname).toBe('/market')
  })

  test('closed registration leaves no signup call to action anywhere in the composed homepage', async () => {
    await renderHome({ ...openRegistration, register_enabled: false })

    expect(
      screen.getByText('New account registration is currently unavailable.')
    ).toBeVisible()
    expect(screen.getByLabelText('Username or Email')).toBeVisible()
    expect(
      screen.queryByRole('button', {
        name: /Create account|Sign up|Get Started/i,
      })
    ).not.toBeInTheDocument()
    const navigationActions = [
      ...screen.getAllByRole('link'),
      ...screen.getAllByRole('button'),
    ]
    expect(
      navigationActions.filter((action) =>
        action.getAttribute('href')?.startsWith('/sign-up')
      )
    ).toHaveLength(0)
    // This is instructional copy, not an actionable registration control.
    expect(
      screen.getByRole('heading', { name: 'Create your account' })
    ).toBeVisible()
  })
})
