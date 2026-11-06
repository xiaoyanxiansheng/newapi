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

test('an extension read on a redirected origin stops before any account or Key request', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(
    discoverUpstreamPage(undefined, false, undefined, {
      expected_origin: 'https://another.example',
    })
  ).rejects.toThrow('Complete its login and retry authorization')
  expect(fetcher).not.toHaveBeenCalled()
})

test('an unseen website discovers paginated New API Keys using its browser cookie without a refresh endpoint', async () => {
  const fetcher = vi.fn(async (path: string, options: RequestInit) => {
    expect(options.credentials).toBe('include')
    if (path === '/api/user/self') {
      return new Response(
        JSON.stringify({ success: true, data: { id: 7, username: 'owner' } })
      )
    }
    if (path.startsWith('/api/token/?')) {
      const page = new URL(path, location.origin).searchParams.get('p')
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            items: [
              {
                id: Number(page),
                name: `Key ${page}`,
                key: 'masked********',
                group: 'cheap',
                status: 1,
              },
            ],
            total: 2,
          },
        })
      )
    }
    if (path.startsWith('/api/token/') && path.endsWith('/key')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: 'sk-existing-secret-' + path.split('/')[3],
        })
      )
    }
    if (path === '/api/pricing') {
      return new Response(JSON.stringify({ success: true, data: [] }))
    }
    if (path === '/api/status') {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            quota_per_unit: 500000,
            quota_display_type: 'CNY',
            usd_exchange_rate: 1,
          },
        })
      )
    }
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const snapshot = await discoverUpstreamPage()
  expect(snapshot.connector.kind).toBe('newapi')
  expect(snapshot.keys.map((key) => key.id)).toEqual([1, 2])
  expect(snapshot.keys[0].key).toBe('sk-existing-secret-1')
  expect(snapshot.complete).toBe(true)
  expect(
    fetcher.mock.calls.some(([path]) => path === '/api/user/auth/refresh')
  ).toBe(false)
})

test('an unfamiliar Key page falls back to visible complete Keys and keeps masked rows out of its import', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 }))
  )
  document.body.innerHTML =
    '<table><tr><td>Research</td><td><input readonly value="sk-visible-existing-secret"></td></tr><tr><td>Hidden</td><td>sk-abcdefghijklmnop********xyz</td></tr></table>'
  const snapshot = await discoverUpstreamPage()
  expect(snapshot.connector.kind).toBe('page')
  expect(snapshot.keys).toHaveLength(1)
  expect(snapshot.keys[0].key).toBe('sk-visible-existing-secret')
  expect(snapshot.complete).toBe(false)
})

test('a generic API preserves unprefixed Keys and reuses its learned list and model routes', async () => {
  const fetcher = vi.fn(async (path: string) => {
    if (path === '/api/keys') {
      return new Response(
        JSON.stringify({
          keys: [
            {
              id: 'owned-key',
              name: 'mine',
              api_key: 'existing-plain-key-value',
              group: 'vip',
            },
          ],
          total: 1,
        })
      )
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetcher)
  const snapshot = await discoverUpstreamPage({
    kind: 'api',
    list_path: '/api/keys',
    models_path: '/api/v1/models',
  })
  expect(snapshot.keys[0].key).toBe('existing-plain-key-value')
  expect(snapshot.connector).toMatchObject({
    list_path: '/api/keys',
    models_path: '/api/v1/models',
  })
  expect(
    fetcher.mock.calls.some(([path]) => path.startsWith('/api/token/'))
  ).toBe(false)
})

test('page discovery reveals each existing Key once and reads Next without invoking edit controls', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 }))
  )
  document.body.innerHTML =
    '<table><tr><td>First</td><td><code>sk-hidden********</code></td><td><button aria-label="Show Key"><span class="semi-icon-eye"></span></button><button>Edit</button></td></tr></table><button aria-label="Next">Next</button>'
  const reveal = document.querySelector('button[aria-label="Show Key"]')
  expect(reveal).not.toBeNull()
  const revealClick = vi.fn(() => {
    const code = document.querySelector('code')
    if (code) code.textContent = 'sk-first-existing-secret'
  })
  reveal?.addEventListener('click', revealClick)
  const editClick = vi.fn()
  document.querySelectorAll('button')[1].addEventListener('click', editClick)
  document
    .querySelector('button[aria-label="Next"]')
    ?.addEventListener('click', () => {
      document.body.innerHTML =
        '<table><tr><td>Second</td><td><input readonly value="sk-second-existing-secret"></td></tr></table><button aria-label="Next" disabled>Next</button>'
    })
  const snapshot = await discoverUpstreamPage()
  expect(snapshot.keys.map((key) => key.key)).toEqual([
    'sk-first-existing-secret',
    'sk-second-existing-secret',
  ])
  expect(revealClick).toHaveBeenCalledTimes(1)
  expect(editClick).not.toHaveBeenCalled()
  expect(snapshot.complete).toBe(false)
})

test('selecting an unfamiliar Key region saves its selector and later refreshes it without another selection', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 }))
  )
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  document.body.innerHTML =
    '<div id="custom-secret">unprefixed-existing-key-value</div><input readonly value="irrelevant-readonly-value">'
  const pageAction = vi.fn()
  const key = document.querySelector<HTMLElement>('#custom-secret')
  key?.addEventListener('click', pageAction)
  const read = discoverUpstreamPage(undefined, true)
  await vi.waitFor(
    () =>
      expect(document.querySelector('button')?.textContent).toBe(
        'Select the Key area'
      ),
    { timeout: 5000 }
  )
  document.querySelector('button')?.click()
  key?.click()
  const snapshot = await read
  expect(snapshot.keys).toHaveLength(1)
  expect(snapshot.keys[0].key).toBe('unprefixed-existing-key-value')
  expect(snapshot.connector.key_selector).toBe('#custom-secret')
  expect(pageAction).not.toHaveBeenCalled()
  const refreshed = await discoverUpstreamPage(snapshot.connector)
  expect(refreshed.keys).toEqual(snapshot.keys)
  expect(document.querySelector('button')).toBeNull()
})
