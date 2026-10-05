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
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { AxiosAdapter } from 'axios'
import { createInstance, type i18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ThemeProvider } from '@/context/theme-provider'
import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore } from '@/stores/notification-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { Home } from '..'

const originalAdapter = api.defaults.adapter
const originalAuth = useAuthStore.getState()
const originalSystemConfig = useSystemConfigStore.getState()
const originalNotifications = useNotificationStore.getState()
let originalRouter: typeof window.__TSR_ROUTER__
let originalRootClass: string
let originalBodyOverflow: string
let queryClient: QueryClient
let history: ReturnType<typeof createMemoryHistory>
let cancelMatches: (() => void) | undefined
let translations: i18n

async function renderConfiguredHome(content: string) {
  api.defaults.adapter = vi.fn<AxiosAdapter>(async (config) => {
    if (config.method !== 'get' || config.url !== '/api/home_page_content') {
      throw new Error(`Unexpected request: ${config.method} ${config.url}`)
    }
    return {
      config,
      data: { success: true, data: content },
      status: 200,
      statusText: 'OK',
      headers: {},
    }
  })
  const root = createRootRoute({ component: Home })
  const router = createRouter({ routeTree: root, history })
  cancelMatches = () => router.cancelMatches()
  await router.load()
  return render(
    <I18nextProvider i18n={translations}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          defaultTheme='light'
          storageKey='home-content-test-theme'
        >
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

beforeEach(async () => {
  originalRouter = window.__TSR_ROUTER__
  originalRootClass = document.documentElement.className
  originalBodyOverflow = document.body.style.overflow
  cancelMatches = undefined
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  queryClient.setQueryData(['status'], {
    register_enabled: true,
    password_register_enabled: true,
    password_login_enabled: true,
  })
  queryClient.setQueryData(['notice'], { success: true, data: '' })
  history = createMemoryHistory({ initialEntries: ['/'] })
})

afterEach(async () => {
  cleanup()
  cancelMatches?.()
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

describe('configured homepage content', () => {
  test('configured HTML replaces the landing with isolated administrator content', async () => {
    const { container } = await renderConfiguredHome(
      '<section><h1>Custom HTML home</h1><a href="https://example.test/help">HTML guide</a></section>'
    )

    await waitFor(() => {
      const wrapper = container
        .querySelector('.custom-home-content')
        ?.shadowRoot?.querySelector('div')
      expect(wrapper).toBeInstanceOf(HTMLElement)
      expect(
        within(wrapper as HTMLElement).getByRole('heading', {
          name: 'Custom HTML home',
        })
      ).toBeInTheDocument()
      expect(
        within(wrapper as HTMLElement).getByRole('link', { name: 'HTML guide' })
      ).toHaveAttribute('href', 'https://example.test/help')
    })
    expect(
      screen.queryByRole('heading', { name: 'Sign in to hwjai' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('tablist', { name: 'Account access' })
    ).not.toBeInTheDocument()
    expect(screen.queryByTitle('Custom Home Page')).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('banner')).getByRole('link', {
        name: /Configured site/,
      })
    ).toHaveAttribute('href', '/')
  })

  test('configured Markdown replaces the landing with rendered headings and links rather than raw markup', async () => {
    await renderConfiguredHome(
      '# Custom Markdown home\n\n[Markdown guide](https://example.test/markdown)'
    )

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Custom Markdown home',
      })
    ).toBeVisible()
    expect(
      within(screen.getByRole('main')).getByRole('link', {
        name: 'Markdown guide',
      })
    ).toHaveAttribute('href', 'https://example.test/markdown')
    expect(screen.queryByText('# Custom Markdown home')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Sign in to hwjai' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('tablist', { name: 'Account access' })
    ).not.toBeInTheDocument()
    expect(screen.queryByTitle('Custom Home Page')).not.toBeInTheDocument()
  })

  test('configured URL replaces the landing with a sandboxed frame and resends preferences on frame load', async () => {
    await renderConfiguredHome('https://custom.example.test/home')
    const frame =
      await screen.findByTitle<HTMLIFrameElement>('Custom Home Page')

    expect(frame).toHaveAttribute('src', 'https://custom.example.test/home')
    const permissions = frame.getAttribute('sandbox')?.split(/\s+/)
    expect(permissions).toEqual(
      expect.arrayContaining([
        'allow-forms',
        'allow-popups',
        'allow-scripts',
        'allow-top-navigation-by-user-activation',
      ])
    )
    expect(permissions).not.toContain('allow-same-origin')
    expect(
      screen.queryByRole('heading', { name: 'Sign in to hwjai' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('tablist', { name: 'Account access' })
    ).not.toBeInTheDocument()

    const contentWindow = frame.contentWindow
    expect(contentWindow).not.toBeNull()
    const postMessage = vi
      .spyOn(contentWindow as Window, 'postMessage')
      .mockImplementation(() => undefined)
    fireEvent.load(frame)
    expect(postMessage).toHaveBeenCalledWith({ themeMode: 'light' }, '*')
    expect(postMessage).toHaveBeenCalledWith({ lang: 'en' }, '*')
  })
})
