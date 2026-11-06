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
import { expect, test, vi } from 'vitest'

import {
  createExtensionHelper,
  type BrowserHelperPlatform,
} from '../lib/extension-core'

const accounts = [{ id: 1, name: 'Site', url: 'https://newsite.example/keys' }]
const sender = {
  tab: { id: 7, url: 'https://hwjai.me/upstream-catalog' },
  frameId: 0,
}
function fixture(granted = true) {
  const stored: Record<string, unknown> = {}
  const browser = {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    permissions: { contains: vi.fn(async () => granted) },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
        set: vi.fn(async (value: Record<string, unknown>) =>
          Object.assign(stored, value)
        ),
        remove: vi.fn(async (key: string) => {
          delete stored[key]
        }),
      },
    },
    tabs: {
      query: vi.fn(async () => [
        { id: 8, url: 'https://newsite.example/keys', status: 'complete' },
      ]),
      get: vi.fn(async (id: number) =>
        id === 7
          ? sender.tab
          : { id, url: 'https://newsite.example/keys', status: 'complete' }
      ),
      create: vi.fn(async (options: { url: string }) => ({
        id: 9,
        url: options.url,
        status: 'complete',
      })),
      update: vi.fn(
        async (id: number, options: { url?: string; active?: boolean }) => ({
          id,
          url: options.url,
          status: 'complete',
        })
      ),
      sendMessage: vi.fn(async () => {}),
    },
    scripting: {
      executeScript: vi.fn(async () => [
        {
          result: {
            page_url: accounts[0].url,
            connector: { kind: 'newapi' as const },
            identity: { id: 3, username: 'owner', email: '' },
            keys: [],
            complete: true,
            money_only: true,
            balance_cny: '0.00',
          },
        },
      ]),
    },
  } satisfies BrowserHelperPlatform
  return { browser, stored, helper: createExtensionHelper(browser, vi.fn()) }
}
test('connect reuses an existing website tab without reading keys or requesting host access', async () => {
  const f = fixture()
  expect(
    await f.helper.handle(
      { operation: 'open', request_id: 'open-1', accounts },
      sender
    )
  ).toEqual({ opened: [1] })
  expect(f.browser.tabs.create).not.toHaveBeenCalled()
  expect(f.browser.scripting.executeScript).not.toHaveBeenCalled()
})
test('unknown domains require permission before any reading and the pending job stores no keys or cookies', async () => {
  const f = fixture(false)
  const result = await f.helper.handle(
    { operation: 'read', request_id: 'read-1', accounts },
    sender
  )
  expect(result).toEqual({ pending: true })
  expect(f.browser.scripting.executeScript).not.toHaveBeenCalled()
  expect(f.browser.tabs.create).toHaveBeenCalledWith(
    expect.objectContaining({ url: expect.stringContaining('approve.html') })
  )
  expect(JSON.stringify(f.stored)).not.toMatch(
    /access_token|cookie|balance_cny/
  )
})
test('balance reads use only the approved origin and do not retain the returned amount or secrets', async () => {
  const f = fixture()
  const result = await f.helper.handle(
    { operation: 'read', request_id: 'read-1', accounts, money_only: true },
    sender
  )
  expect(result.results?.[0]?.discovery?.balance_cny).toBe('0.00')
  expect(f.browser.scripting.executeScript).toHaveBeenCalledWith(
    expect.objectContaining({
      world: 'MAIN',
      args: [
        undefined,
        false,
        expect.any(Object),
        {
          money_only: true,
          expected_origin: 'https://newsite.example',
          balance_page_url: undefined,
        },
      ],
    })
  )
  expect(f.stored).toEqual({})
})
test('requests from other websites, subframes, duplicate accounts or cross-origin balance pages cannot trigger reading', async () => {
  const f = fixture()
  for (const bad of [
    { ...sender, tab: { id: 7, url: 'https://evil.example' } },
    { ...sender, frameId: 1 },
  ]) {
    await expect(
      f.helper.handle({ operation: 'read', request_id: 'x', accounts }, bad)
    ).rejects.toThrow()
  }
  for (const invalid of [
    [...accounts, ...accounts],
    [{ ...accounts[0], balance_page_url: 'https://other.example/balance' }],
  ]) {
    await expect(
      f.helper.handle(
        { operation: 'read', request_id: 'x', accounts: invalid },
        sender
      )
    ).rejects.toThrow()
  }
  expect(f.browser.scripting.executeScript).not.toHaveBeenCalled()
})
test('one permission grant reads the whole pending batch and delivers only to its originating hwjai tab', async () => {
  const f = fixture(false)
  await f.helper.handle(
    { operation: 'read', request_id: 'read-1', accounts },
    sender
  )
  const job = Object.keys(f.stored)[0].slice(4)
  const approval = { url: `chrome-extension://test/approve.html#${job}` }
  await expect(
    f.helper.handle(
      { operation: 'approve', request_id: 'approval', job_id: job },
      approval
    )
  ).rejects.toThrow('Website access was not granted')
  f.browser.permissions.contains.mockResolvedValue(true)
  await f.helper.handle(
    { operation: 'approve', request_id: 'approval', job_id: job },
    approval
  )
  expect(f.browser.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({
      request_id: 'read-1',
      client_origin: 'https://hwjai.me',
      result: expect.objectContaining({ results: expect.any(Array) }),
    })
  )
  expect(f.stored).toEqual({})
})
test('a different extension cannot approve a pending website batch', async () => {
  const f = fixture(false)
  await f.helper.handle(
    { operation: 'read', request_id: 'read-1', accounts },
    sender
  )
  const job = Object.keys(f.stored)[0].slice(4)
  await expect(
    f.helper.handle(
      { operation: 'approve', request_id: 'approval', job_id: job },
      { url: `chrome-extension://other/approve.html#${job}` }
    )
  ).rejects.toThrow('Invalid authorization window')
  expect(f.browser.scripting.executeScript).not.toHaveBeenCalled()
})
