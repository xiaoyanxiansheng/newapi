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
import { afterEach, expect, test, vi } from 'vitest'

import { discoverUpstreamPage } from '../lib/browser-discovery'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  localStorage.clear()
})

function mockSite(options: { currency?: string; quota?: number } = {}) {
  const fetcher = vi.fn(async (path: string) => {
    let data: unknown
    if (path === '/api/user/self') {
      data = { id: 7, username: 'owner', quota: options.quota ?? 125000000 }
    } else if (path === '/api/status') {
      data = {
        quota_display_type: options.currency ?? 'CNY',
        quota_per_unit: 500000,
        usd_exchange_rate: 1,
      }
    } else if (path.startsWith('/api/token/?')) {
      data = {
        items: [
          {
            id: 1,
            name: 'cc-max',
            key: 'sk-existing-first-secret',
            status: 1,
            group: 'vip',
            unlimited_quota: true,
            used_quota: 39380000,
          },
          {
            id: 2,
            name: 'unused',
            key: 'sk-existing-second-secret',
            status: 1,
            group: 'vip',
            used_quota: 0,
          },
        ],
        total: 2,
      }
    } else {
      return new Response('{}', { status: 404 })
    }
    return new Response(JSON.stringify({ success: true, data }))
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

test('authorized Key reading imports each Key consumption independently from the account balance, including unlimited and zero-use Keys', async () => {
  mockSite()
  const snapshot = await discoverUpstreamPage()
  expect(snapshot.balance_cny).toBe('250.00')
  expect(snapshot.keys.map((key) => key.used_cny)).toEqual(['78.76', '0.00'])
})

test('a balance-page authorization reads its visible RMB balance without reading or changing Keys', async () => {
  const fetcher = vi.fn(
    async (_path: string) => new Response('{}', { status: 404 })
  )
  vi.stubGlobal('fetch', fetcher)
  document.body.innerHTML =
    '<section><h2>账户余额</h2><strong>¥1,234.56</strong></section><section>累计消费 ¥999.00</section>'
  const snapshot = await discoverUpstreamPage(undefined, false, undefined, {
    money_only: true,
  })
  expect(snapshot.money_only).toBe(true)
  expect(snapshot.balance_cny).toBe('1234.56')
  expect(snapshot.keys).toEqual([])
  expect(snapshot.complete).toBe(false)
  expect(fetcher.mock.calls.some(([path]) => /token|keys/.test(path))).toBe(
    false
  )
})

test('a supplied balance page is read using the same browser session when the Key page has no account balance', async () => {
  const ordinary = mockSite()
  const original = ordinary.getMockImplementation()
  if (!original) throw new Error('Site fixture implementation is missing')
  ordinary.mockImplementation(async (path: string) => {
    if (path === '/api/user/self') {
      return new Response(
        JSON.stringify({ success: true, data: { id: 7, username: 'owner' } })
      )
    }
    if (path === '/wallet/overview') {
      return new Response('<section>当前余额 <strong>¥42.50</strong></section>')
    }
    return original(path)
  })
  const snapshot = await discoverUpstreamPage(undefined, false, undefined, {
    balance_page_url: new URL('/wallet/overview', location.origin).href,
  })
  expect(snapshot.balance_cny).toBe('42.50')
  expect(snapshot.keys).toHaveLength(2)
})

test('USD quotas are not relabeled as RMB and missing balance remains unknown', async () => {
  mockSite({ currency: 'USD' })
  const snapshot = await discoverUpstreamPage()
  expect(snapshot.balance_cny).toBeUndefined()
  expect(snapshot.balance_issue).toBe('not_found')
  expect(snapshot.keys.every((key) => !key.used_cny)).toBe(true)
})

test('a Key table without currency symbols reads the consumption column beside unlimited quota', async () => {
  const fetcher = vi.fn(
    async (_path: string) => new Response('{}', { status: 404 })
  )
  vi.stubGlobal('fetch', fetcher)
  document.body.innerHTML = `
    <table>
      <thead><tr><th>名称</th><th>API 密钥</th><th>额度 (¥)</th><th>分组</th></tr></thead>
      <tbody><tr><td>cc-max</td><td><code>sk-visible-table-secret</code></td><td>无限制</td><td>78.76</td><td>vip</td></tr></tbody>
    </table>`
  const snapshot = await discoverUpstreamPage()
  expect(snapshot.keys).toHaveLength(1)
  expect(snapshot.keys[0].used_cny).toBe('78.76')
})
