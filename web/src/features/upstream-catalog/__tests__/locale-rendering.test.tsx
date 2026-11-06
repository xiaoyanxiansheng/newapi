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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, expect, test, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { UpstreamCatalog } from '..'
import { SelectionPreview } from '../components/selection-preview'
import { translateUpstreamError } from '../errors'
import { registerBrowserReader } from '../lib/browser-read'
import type { UpstreamAccount } from '../types'

const account: UpstreamAccount = {
  id: 1,
  name: 'CCTQ',
  website: 'https://www.cctq.ai',
  username: 'owner',
  markup: '1.1',
  revision: 1,
  last_sync: 0,
  last_error: '',
  workflow: 'cctq-existing-keys-v1',
}

test('unverified Sub2API account rates tell users to reauthorize in their selected language', async () => {
  const i18n = createInstance()
  await i18n.init({
    resources: { en, zhCN },
    lng: 'zhCN',
    fallbackLng: 'en',
    nsSeparator: false,
  })
  const message =
    'authorize the upstream Key page again to read its group catalog and account-specific rates'
  expect(translateUpstreamError(message, i18n.t)).toBe(
    '请对上游 Key 页面重新授权，读取分组价格和账号专属倍率。'
  )
  await i18n.changeLanguage('en')
  expect(translateUpstreamError(message, i18n.t)).toBe(message)
})
let client: QueryClient

test('a successfully authorized Key whose group has no catalog prices points to provider pricing instead of repeated authorization', async () => {
  const i18n = createInstance()
  await i18n.init({
    resources: { en, zhCN },
    lng: 'zhCN',
    fallbackLng: 'en',
    nsSeparator: false,
  })
  const message =
    "the upstream website has not exposed model prices for this Key's group; confirm its full pricing rules with the provider before publishing"
  expect(translateUpstreamError(message, i18n.t)).toBe(
    '上游网站未提供此 Key 分组的模型单价。请向上游核实完整计价规则后再上架，重复授权无法补齐未提供的价格。'
  )
  expect(
    translateUpstreamError(
      "this Key's group is absent from its authorized model plaza; previous prices were preserved",
      i18n.t
    )
  ).toBe(translateUpstreamError(message, i18n.t))
  await i18n.changeLanguage('en')
  expect(translateUpstreamError(message, i18n.t)).toBe(message)
  expect(
    translateUpstreamError(
      "this Key's group is absent from its authorized model plaza; previous prices were preserved",
      i18n.t
    )
  ).toBe(message)
})
const cleanupReaders: Array<() => void> = []

afterEach(() => {
  client?.clear()
  cleanupReaders.splice(0).forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
})

async function mount(savedError = '', savedAccount = account) {
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({
    resources: { en, zhCN },
    lng: 'zhCN',
    fallbackLng: 'en',
    nsSeparator: false,
    interpolation: { escapeValue: false },
  })
  let lastError = savedError
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/market/admin/upstream-accounts') {
      return { data: { success: true, data: [savedAccount] } }
    }
    if (url === '/api/market/admin/upstream-accounts/1') {
      return {
        data: {
          success: true,
          data: {
            account: { ...savedAccount, last_error: lastError },
            keys: [],
          },
        },
      }
    }
    throw new Error(`Unexpected endpoint: ${url}`)
  })
  vi.spyOn(api, 'post').mockImplementation(async () => {
    lastError = savedError
    return { data: { success: false, message: savedError } }
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <UpstreamCatalog />
      </QueryClientProvider>
    </I18nextProvider>
  )
  await screen.findByText(savedAccount.username, {}, { timeout: 10_000 })
  return i18n
}

test('batch connection buttons and installation instructions use Chinese and switch back to English', async () => {
  const i18n = await mount()
  expect(screen.getByRole('button', { name: '一键连接' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '一键授权' })).toBeEnabled()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '一键连接' }))
  const dialog = await screen.findByRole(
    'dialog',
    { name: '安装浏览器助手' },
    { timeout: 5000 }
  )
  expect(
    within(dialog).getByRole('link', { name: '下载浏览器助手' })
  ).toBeInTheDocument()
  await act(() => i18n.changeLanguage('en'))
  expect(
    screen.getByRole('dialog', { name: 'Install browser helper' })
  ).toBeInTheDocument()
  expect(
    within(dialog).getByRole('link', { name: 'Download browser helper' })
  ).toBeInTheDocument()
})

test('Chinese balance refresh without a live authorization shows a translated reconnect instruction and keeps the saved amount', async () => {
  const i18n = await mount('', {
    ...account,
    auth_type: 'browser',
    balance_cny: '12.00',
    balance_read_time: 100,
  })
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '一键刷新余额' }))
  const card = screen.getByRole('button', { name: 'CCTQ 的网站余额' })
  expect(await within(card).findByRole('alert')).toHaveTextContent(
    '请打开上游网站并点击授权书签，再刷新余额。'
  )
  expect(within(card).getByText('¥12.00')).toBeInTheDocument()
  await act(() => i18n.changeLanguage('en'))
  expect(
    screen.getByRole('button', { name: 'Refresh all balances' })
  ).toBeEnabled()
  expect(within(card).getByRole('alert')).toHaveTextContent(
    'Open the upstream website and click the authorization bookmark to refresh its balance.'
  )
})

test('Chinese balance refresh shows translated progress and completion and switches the result to English', async () => {
  const i18n = await mount()
  let finishRead: () => void = () => {}
  const reading = new Promise<void>((resolve) => {
    finishRead = resolve
  })
  cleanupReaders.push(registerBrowserReader(account.id, async () => reading))
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '一键刷新余额' }))
  const card = screen.getByRole('button', { name: 'CCTQ 的网站余额' })
  expect(within(card).getByRole('status')).toHaveTextContent('正在刷新余额…')
  await act(async () => {
    finishRead()
    await reading
  })
  await waitFor(() =>
    expect(within(card).getByRole('status')).toHaveTextContent('余额已刷新')
  )
  await act(() => i18n.changeLanguage('en'))
  expect(within(card).getByRole('status')).toHaveTextContent(
    'Balance refreshed'
  )
})

test('selecting Chinese translates the upstream page and account form using the shipped locale files', async () => {
  const i18n = await mount()
  expect(
    screen.getByRole('heading', { name: '已有 Key，专属模型，自定售价。' })
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '读取已有 Key' })).toBeEnabled()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '账号设置' }))
  const dialog = await screen.findByRole('dialog', { name: '账号设置' })
  expect(within(dialog).getByLabelText('网站名称')).toBeInTheDocument()
  expect(within(dialog).getByLabelText('默认加价倍率')).toBeInTheDocument()
  expect(within(dialog).getAllByRole('textbox')).toHaveLength(4)
  expect(
    within(dialog).getByLabelText('余额页面网址（可选）')
  ).toBeInTheDocument()
  expect(within(dialog).getByLabelText('Key 管理页面')).toHaveValue(
    'https://www.cctq.ai/keys'
  )
  expect(within(dialog).queryByLabelText('登录方式')).not.toBeInTheDocument()
  expect(
    within(dialog).queryByLabelText('网站登录密码')
  ).not.toBeInTheDocument()
  expect(
    within(dialog).getByText(
      '将下方书签拖到浏览器书签栏。打开上游网站并登录，在 Key 页面点击书签即可授权。'
    )
  ).toBeInTheDocument()
  await act(() => i18n.changeLanguage('en'))
  expect(
    within(dialog).getByRole('button', { name: 'Save upstream account' })
  ).toBeInTheDocument()
})

test('Chinese browser accounts display translated connection instructions and switch back to English', async () => {
  const i18n = await mount('', {
    ...account,
    auth_type: 'browser',
    has_session: false,
  })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '账号设置' }))
  const dialog = screen.getByRole('dialog', { name: '账号设置' })
  expect(
    within(dialog).getByRole('link', { name: '连接到 hwjai' })
  ).toBeInTheDocument()
  expect(
    within(dialog).getByText(
      '将下方书签拖到浏览器书签栏。打开上游网站并登录，在 Key 页面点击书签即可授权。'
    )
  ).toBeInTheDocument()
  expect(
    within(dialog).getByRole('button', { name: '打开上游网站' })
  ).toBeEnabled()
  await act(() => i18n.changeLanguage('en'))
  expect(
    screen.getByRole('dialog', { name: 'Account settings' })
  ).toBeInTheDocument()
  expect(
    within(dialog).getByRole('button', { name: 'Open upstream website' })
  ).toBeEnabled()
})

test('Chinese shows both Key entry methods and a manual form without website credentials', async () => {
  const i18n = await mount()
  const user = userEvent.setup()
  expect(screen.getByRole('tab', { name: '账号读取' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByRole('tab', { name: '手动 Key' })).toHaveAttribute(
    'aria-selected',
    'false'
  )
  await user.click(screen.getByRole('button', { name: '添加上游' }))
  await user.click(screen.getByRole('tab', { name: '填写地址和 Key' }))
  const dialog = screen.getByRole('dialog', { name: '添加上游' })
  expect(within(dialog).getByLabelText('API 地址')).toBeInTheDocument()
  expect(within(dialog).getByLabelText('API Key')).toHaveAttribute(
    'type',
    'password'
  )
  expect(
    within(dialog).queryByLabelText('网站登录密码')
  ).not.toBeInTheDocument()
  expect(
    within(dialog).getByRole('button', { name: '保存 Key' })
  ).toBeInTheDocument()
  await act(() => i18n.changeLanguage('en'))
  expect(
    within(dialog).getByRole('tab', { name: 'Enter address and Key' })
  ).toHaveAttribute('aria-selected', 'true')
})

test('a rejected refresh shows one Chinese login error even when the same error is saved on the account', async () => {
  const message =
    'upstream login was not accepted; check username, password and any required verification'
  await mount(message)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '读取已有 Key' }))
  await waitFor(() => expect(api.post).toHaveBeenCalled())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '读取已有 Key' })).toBeEnabled()
  )
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1))
  expect(screen.getByRole('alert')).toHaveTextContent('上游网站未接受登录')
  expect(screen.getByRole('alert')).not.toHaveTextContent(message)
})

test('Chinese upstream errors keep the HTTP status and translate the recovery instruction', async () => {
  await mount('upstream returned HTTP 403; check account access and retry')
  expect(screen.getByRole('alert')).toHaveTextContent('HTTP 403')
  expect(screen.getByRole('alert')).toHaveTextContent('检查账号权限')
  expect(screen.getByRole('alert')).not.toHaveTextContent(
    'check account access'
  )
})

test('expired hwjai authorization explains bookmark renewal without demanding another upstream login', async () => {
  await mount(
    'upstream browser authorization expired or was rejected; sign in again and reconnect the account'
  )
  expect(screen.getByRole('alert')).toHaveTextContent('hwjai 的上游授权')
  expect(screen.getByRole('alert')).toHaveTextContent('连接书签即可续期')
  expect(screen.getByRole('alert')).toHaveTextContent(
    '仅在上游网站要求时重新登录'
  )
})

test('a price mismatch is explained in Chinese and continues to block publishing', async () => {
  const i18n = await mount()
  render(
    <I18nextProvider i18n={i18n}>
      <SelectionPreview
        preview={{
          channel_name: 'Existing Key',
          creates_channel: true,
          fingerprint: 'server-price-fingerprint',
          proposals: [
            {
              model: 'example',
              markup: '1.1',
              original: {},
              cost: {},
              sale: {},
              unit: 'per_million_tokens',
              ratio: 0,
              current_ratio: 0,
              listing_id: 0,
              enabled: true,
              issue:
                'input, output or cache prices require different ratios; adjust existing model pricing manually before applying',
            },
          ],
        }}
        busy={false}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />
    </I18nextProvider>
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    '输入、输出或缓存价格需要不同倍率'
  )
  expect(screen.getByRole('button', { name: '确认上架' })).toBeDisabled()
})
