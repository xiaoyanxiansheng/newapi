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
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { discoverUpstreamPage } from '../lib/browser-discovery'

beforeEach(() => {
  localStorage.setItem('auth_token', 'existing-browser-session')
  localStorage.setItem('auth_user', JSON.stringify({ id: 7, balance: 999 }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.innerHTML = ''
})

test('Sub2API authorization reads the logged-in model plaza and verified user group rates with each Key group ID', async () => {
  const catalog = {
    code: 0,
    data: {
      groups: [{ id: 20, name: 'CCMAX', rate_multiplier: 0.9, models: [] }],
    },
  }
  const rates = { code: 0, data: { 20: 0.5 } }
  const availableGroups = {
    code: 0,
    data: [
      {
        id: 24,
        name: 'Image004',
        allow_image_generation: true,
        image_rate_independent: true,
        image_rate_multiplier: 0.5,
        image_price_1k: 0.05,
        image_price_2k: 0.05,
        image_price_4k: 0.05,
      },
    ],
  }
  const fetcher = vi.fn(async (path: string, _options: RequestInit) => {
    if (path === '/api/v1/auth/me') {
      return Response.json({ code: 0, data: { id: 7 } })
    }
    if (path === '/api/v1/keys?page=1&page_size=100') {
      return Response.json({
        code: 0,
        data: {
          items: [
            {
              id: 1,
              key: 'sk-existing-full-secret',
              status: 'active',
              group_id: 20,
              group: { id: 20, name: 'CCMAX' },
            },
          ],
          total: 1,
        },
      })
    }
    if (path === '/api/v1/model-plaza') return Response.json(catalog)
    if (path === '/api/v1/groups/rates') return Response.json(rates)
    if (path === '/api/v1/groups/available') {
      return Response.json(availableGroups)
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetcher)
  const snapshot = await discoverUpstreamPage()
  expect(snapshot).toMatchObject({
    sub2api_pricing: {
      catalog,
      group_rates: rates,
      available_groups: availableGroups,
    },
    keys: [{ group_id: 20 }],
  })
  for (const [path, options] of fetcher.mock.calls.filter(([path]) =>
    ['/api/v1/model-plaza', '/api/v1/groups/rates'].includes(path)
  )) {
    expect(options.method, path).toBe('GET')
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer existing-browser-session',
    })
  }
})

test('Sub2API reads every existing Key and its actual cost using the authorized browser session', async () => {
  document.body.innerHTML = '<code>sk-9c7...d66c</code>'
  const fetcher = vi.fn(async (path: string, options: RequestInit) => {
    expect(path.startsWith('/api/v1/')).toBe(true)
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer existing-browser-session',
    })
    expect(options.headers).not.toHaveProperty('New-Api-User')
    expect(options.credentials).toBe('include')
    expect(options.redirect).toBe('error')
    if (path === '/api/v1/auth/me') {
      return Response.json({
        code: 0,
        data: {
          id: 7,
          username: 'owner',
          email: 'owner@example.test',
          balance: 23.45,
        },
      })
    }
    if (path.startsWith('/api/v1/keys?')) {
      const page = Number(
        new URL(path, location.origin).searchParams.get('page')
      )
      expect(options.method).toBe('GET')
      return Response.json({
        code: 0,
        data: {
          items: [
            {
              id: page,
              key: `sk-existing-full-secret-${page}`,
              name: `Key ${page}`,
              status: page === 1 ? 'active' : 'inactive',
              group: { id: 3, name: 'Claude' },
              expires_at: '2027-01-01T00:00:00Z',
              quota_used: 2,
            },
          ],
          total: 2,
          pages: 2,
        },
      })
    }
    if (path === '/api/v1/usage/dashboard/api-keys-usage') {
      expect(options.method).toBe('POST')
      expect(JSON.parse(String(options.body))).toEqual({ api_key_ids: [1, 2] })
      return Response.json({
        code: 0,
        data: {
          stats: {
            1: { total_actual_cost: 4.5678 },
            2: { total_actual_cost: 0 },
          },
        },
      })
    }
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const snapshot = await discoverUpstreamPage()
  expect(snapshot.connector).toMatchObject({
    kind: 'api',
    list_path: '/api/v1/keys?page=1&page_size=100',
    page_start: 1,
  })
  expect(snapshot.complete).toBe(true)
  expect(snapshot.balance_cny).toBe('23.45')
  expect(
    snapshot.keys.map((key) => ({
      id: key.id,
      key: key.key,
      group: key.group,
      status: key.status,
      used: key.used_cny,
      expires: key.expires_at,
    }))
  ).toEqual([
    {
      id: 1,
      key: 'sk-existing-full-secret-1',
      group: 'Claude',
      status: 1,
      used: '4.5678',
      expires: 1798761600,
    },
    {
      id: 2,
      key: 'sk-existing-full-secret-2',
      group: 'Claude',
      status: 2,
      used: '0',
      expires: 1798761600,
    },
  ])
  expect(JSON.stringify(snapshot)).not.toContain('existing-browser-session')
  expect(localStorage.getItem('auth_token')).toBe('existing-browser-session')
  expect(
    fetcher.mock.calls.every(([path]) => path.startsWith('/api/v1/'))
  ).toBe(true)
  expect(
    fetcher.mock.calls
      .filter(([, options]) => options.method === 'POST')
      .map(([path]) => path)
  ).toEqual(['/api/v1/usage/dashboard/api-keys-usage'])
})

test('Sub2API balance-only reads preserve a negative available balance without reading Keys or cached balance', async () => {
  const fetcher = vi.fn(async (path: string) => {
    expect(path).toBe('/api/v1/auth/me')
    return Response.json({
      code: 0,
      data: { id: 7, balance: -0.25, frozen_balance: 3 },
    })
  })
  vi.stubGlobal('fetch', fetcher)
  const snapshot = await discoverUpstreamPage(undefined, false, undefined, {
    money_only: true,
    balance_page_url: 'https://other.example/wallet',
  })
  expect(snapshot.balance_cny).toBe('-0.25')
  expect(snapshot.keys).toEqual([])
  expect(snapshot.connector.kind).toBe('api')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('Sub2API application errors cannot import returned data as a successful Key list', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/v1/auth/me') {
        return Response.json({ code: 0, data: { id: 7, balance: 0 } })
      }
      return Response.json({
        code: 401,
        data: {
          items: [{ id: 1, key: 'sk-rejected-existing-secret' }],
          total: 1,
        },
      })
    })
  )
  await expect(discoverUpstreamPage()).rejects.toThrow(
    'No readable existing Keys'
  )
})

test('Sub2API masked Keys stay incomplete when the read-only detail endpoint cannot reveal them', async () => {
  document.body.innerHTML =
    '<table><tr><td>Key 1</td><td><code>sk-9c712345678901234...d66c</code></td></tr></table>'
  const fetcher = vi.fn(async (path: string, options: RequestInit) => {
    if (path === '/api/v1/auth/me') {
      return Response.json({ code: 0, data: { id: 7, balance: 0 } })
    }
    if (path.startsWith('/api/v1/keys?')) {
      return Response.json({
        code: 0,
        data: {
          items: [{ id: 1, key: 'sk-9c7123456...d66c', status: 'active' }],
          total: 1,
        },
      })
    }
    if (path === '/api/v1/keys/1') {
      expect(options.method).toBe('GET')
      return Response.json({
        code: 0,
        data: { id: 1, key: 'sk-9c7123456...d66c' },
      })
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetcher)
  const snapshot = await discoverUpstreamPage()
  expect(snapshot.keys[0].key).toBe('')
  expect(snapshot.keys[0].used_cny).toBeUndefined()
  expect(snapshot.complete).toBe(false)
})

test('Sub2API reauthorization discards a previously observed filtered or later-page recipe', async () => {
  const fetcher = vi.fn(async (path: string) => {
    if (path === '/api/v1/auth/me') {
      return Response.json({ code: 0, data: { id: 7, balance: 0 } })
    }
    if (path === '/api/v1/keys?page=1&page_size=100') {
      return Response.json({ code: 0, data: { items: [], total: 0 } })
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetcher)
  const snapshot = await discoverUpstreamPage({
    kind: 'api',
    list_path: '/api/v1/keys?page=4&search=one-key',
  })
  expect(snapshot.complete).toBe(true)
  expect(snapshot.keys).toEqual([])
  expect(snapshot.balance_cny).toBe('0')
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
    '/api/v1/auth/me',
    '/api/v1/keys?page=1&page_size=100',
    '/api/v1/model-plaza',
    '/api/v1/groups/rates',
    '/api/v1/groups/available',
  ])
})

test('Sub2API failed later pages keep an existing-Key snapshot incomplete', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/v1/auth/me') {
        return Response.json({ code: 0, data: { id: 7, balance: 0 } })
      }
      if (path === '/api/v1/keys?page=1&page_size=100') {
        return Response.json({
          code: 0,
          data: {
            items: [
              { id: 1, key: 'sk-existing-first-page-secret', status: 'active' },
            ],
            total: 2,
          },
        })
      }
      if (path === '/api/v1/usage/dashboard/api-keys-usage') {
        return Response.json({
          code: 0,
          data: { stats: { 1: { total_actual_cost: 1 } } },
        })
      }
      return new Response('{}', { status: 503 })
    })
  )
  const snapshot = await discoverUpstreamPage()
  expect(snapshot.keys.map((key) => key.id)).toEqual([1])
  expect(snapshot.complete).toBe(false)
})

test('Sub2API expired sessions do not reuse cached identity or send bearer credentials to wallet pages', async () => {
  const fetcher = vi.fn(async (path: string, _options: RequestInit) => {
    if (path === '/wallet') return new Response('<p>No account balance</p>')
    return new Response('{}', { status: 401 })
  })
  vi.stubGlobal('fetch', fetcher)
  const snapshot = await discoverUpstreamPage(undefined, false, undefined, {
    money_only: true,
    balance_page_url: '/wallet',
  })
  expect(snapshot.identity.id).toBe(0)
  expect(snapshot.balance_issue).toBe('not_found')
  expect(snapshot.balance_cny).toBeUndefined()
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
    '/api/v1/auth/me',
    '/wallet',
  ])
  expect(fetcher.mock.calls[1][1]).toMatchObject({
    headers: { Accept: 'application/json,text/html' },
  })
  expect((fetcher.mock.calls[1][1] as RequestInit).headers).not.toHaveProperty(
    'Authorization'
  )
})
