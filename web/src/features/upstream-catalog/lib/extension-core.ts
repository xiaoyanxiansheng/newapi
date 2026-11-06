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
import type {
  discoverUpstreamPage,
  BrowserDiscovery,
} from './browser-discovery'
import type {
  HelperAccount,
  HelperRequest,
  HelperReply,
} from './browser-helper-protocol'

type Tab = { id?: number; url?: string; status?: string; pendingUrl?: string }
type Sender = { tab?: Tab; frameId?: number; url?: string }
export type BrowserHelperPlatform = {
  runtime: { getURL: (path: string) => string }
  permissions: { contains: (query: { origins: string[] }) => Promise<boolean> }
  storage: {
    session: {
      get: (key: string) => Promise<Record<string, unknown>>
      set: (values: Record<string, unknown>) => Promise<unknown>
      remove: (key: string) => Promise<void>
    }
  }
  tabs: {
    query: (query: Record<string, unknown>) => Promise<Tab[]>
    get: (id: number) => Promise<Tab>
    create: (options: { url: string; active?: boolean }) => Promise<Tab>
    update: (
      id: number,
      options: { url?: string; active?: boolean }
    ) => Promise<Tab>
    sendMessage: (id: number, message: unknown) => Promise<unknown>
  }
  scripting: {
    executeScript: (options: {
      target: { tabId: number }
      world: 'MAIN'
      func: typeof discoverUpstreamPage
      args: Parameters<typeof discoverUpstreamPage>
    }) => Promise<Array<{ result?: BrowserDiscovery }>>
  }
}
type Job = {
  client_tab: number
  client_origin: string
  request: HelperRequest
  created_at: number
}
const labels = {
  intro: '无法自动识别完整 Key，请在上游页面展开 Key 后再授权。',
  pick: '选择 Key 区域',
  cancel: '取消',
  choose: '点击已有 Key 的文字区域。',
  retry: '此区域没有完整 Key，请先展开 Key。',
  noKeys:
    'No readable existing Keys were found. Sign in and reveal existing Keys, then authorize all websites again.',
}
function trustedPage(value: string): boolean {
  const url = new URL(value)
  return (
    url.origin === 'https://hwjai.me' ||
    url.origin === 'http://127.0.0.1:3001' ||
    url.origin === 'http://localhost:3001'
  )
}
function validateAccounts(
  accounts: HelperAccount[] | undefined
): HelperAccount[] {
  if (!Array.isArray(accounts) || !accounts.length || accounts.length > 100) {
    throw new Error('Invalid website list.')
  }
  const ids = new Set<number>()
  for (const account of accounts) {
    if (
      !Number.isSafeInteger(account.id) ||
      account.id <= 0 ||
      ids.has(account.id) ||
      typeof account.name !== 'string' ||
      account.name.length > 255
    ) {
      throw new Error('Invalid website list.')
    }
    ids.add(account.id)
    const url = new URL(account.url)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      trustedPage(account.url)
    ) {
      throw new Error('Invalid upstream website.')
    }
    if (account.balance_page_url) {
      const balance = new URL(account.balance_page_url)
      if (
        balance.origin !== url.origin ||
        balance.username ||
        balance.password
      ) {
        throw new Error('Invalid balance page.')
      }
    }
    if (
      account.recipe &&
      !['newapi', 'api', 'page'].includes(account.recipe.kind)
    ) {
      throw new Error('Invalid reading recipe.')
    }
  }
  return accounts
}
export function createExtensionHelper(
  browser: BrowserHelperPlatform,
  discover: typeof discoverUpstreamPage
) {
  const running = new Set<number>()
  async function openAccount(account: HelperAccount): Promise<number> {
    const origin = new URL(account.url).origin
    const tabs = await browser.tabs.query({})
    const existing = tabs.find(
      (tab) => tab.url && new URL(tab.url).origin === origin
    )
    if (existing?.id !== undefined && existing.url === account.url) {
      return existing.id
    }
    const tab =
      existing?.id !== undefined
        ? await browser.tabs.update(existing.id, {
            url: account.url,
            active: false,
          })
        : await browser.tabs.create({ url: account.url, active: false })
    if (tab.id === undefined) {
      throw new Error('The upstream website could not be opened.')
    }
    return tab.id
  }
  async function readAll(request: HelperRequest): Promise<HelperReply> {
    const results: NonNullable<HelperReply['results']> = []
    // Read sequentially so duplicate websites sharing one browser session cannot
    // navigate the same tab while another account is still being read.
    for (const account of validateAccounts(request.accounts)) {
      try {
        const page =
          request.money_only && account.balance_page_url
            ? { ...account, url: account.balance_page_url }
            : account
        const tabId = await openAccount(page)
        const origin = new URL(account.url).origin
        const deadline = Date.now() + 30000
        let tab = await browser.tabs.get(tabId)
        while (
          (tab.status !== 'complete' || tab.pendingUrl) &&
          Date.now() < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          tab = await browser.tabs.get(tabId)
        }
        if (
          tab.status !== 'complete' ||
          tab.pendingUrl ||
          !tab.url ||
          new URL(tab.url).origin !== origin
        ) {
          throw new Error(
            'The upstream page could not be read. Complete its login and retry authorization.'
          )
        }
        const values = await browser.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: discover,
          args: [
            account.recipe,
            false,
            labels,
            {
              money_only: request.money_only === true,
              expected_origin: origin,
              balance_page_url: account.balance_page_url,
            },
          ],
        })
        const discovery = values[0]?.result
        if (!discovery || new URL(discovery.page_url).origin !== origin) {
          throw new Error(
            'The upstream page could not be read. Complete its login and retry authorization.'
          )
        }
        results.push({ id: account.id, discovery })
      } catch (error) {
        let message = error instanceof Error ? error.message : ''
        if (
          !message ||
          /Cannot access|Missing host permission|Frame.*removed|No tab|Receiving end|closed|No frame/.test(
            message
          )
        ) {
          message =
            'The upstream page could not be read. Complete its login and retry authorization.'
        }
        results.push({ id: account.id, error: message })
      }
    }
    return { results }
  }
  async function handle(
    request: HelperRequest,
    sender: Sender
  ): Promise<HelperReply> {
    if (
      !request ||
      typeof request.request_id !== 'string' ||
      request.request_id.length > 100 ||
      JSON.stringify(request).length > 128000
    ) {
      throw new Error('Invalid helper request.')
    }
    if (request.operation === 'job' || request.operation === 'approve') {
      if (
        !sender.url ||
        sender.url.split('#')[0] !== browser.runtime.getURL('approve.html')
      ) {
        throw new Error('Invalid authorization window.')
      }
      const key = `job-${request.job_id}`
      const saved = await browser.storage.session.get(key)
      const job = saved[key] as Job | undefined
      if (!job || Date.now() - job.created_at > 240000) {
        throw new Error(
          'The authorization request expired. Return to hwjai and retry.'
        )
      }
      const accounts = validateAccounts(job.request.accounts)
      const origins = [
        ...new Set(
          accounts.map((account) => `${new URL(account.url).origin}/*`)
        ),
      ]
      if (request.operation === 'job') return { accounts, origins }
      const tab = await browser.tabs.get(job.client_tab)
      if (
        !tab.url ||
        !trustedPage(tab.url) ||
        new URL(tab.url).origin !== job.client_origin
      ) {
        throw new Error('The hwjai page was closed. Return to hwjai and retry.')
      }
      if (!(await browser.permissions.contains({ origins }))) {
        throw new Error('Website access was not granted.')
      }
      if (running.has(job.client_tab)) {
        throw new Error('A website read is already running.')
      }
      running.add(job.client_tab)
      try {
        const result = await readAll(job.request)
        await browser.tabs.sendMessage(job.client_tab, {
          type: 'hwjai-helper-response',
          request_id: job.request.request_id,
          result,
          client_origin: job.client_origin,
        })
        return { ready: true }
      } finally {
        running.delete(job.client_tab)
        await browser.storage.session.remove(key)
      }
    }
    if (
      sender.frameId !== 0 ||
      sender.tab?.id === undefined ||
      !sender.tab.url ||
      !trustedPage(sender.tab.url)
    ) {
      throw new Error('Only the hwjai administrator page can use this helper.')
    }
    if (request.operation === 'ping') return { ready: true, version: 1 }
    const accounts = validateAccounts(request.accounts)
    if (request.operation === 'open') {
      const opened: number[] = []
      const failures: NonNullable<HelperReply['results']> = []
      for (const account of accounts) {
        try {
          await openAccount(account)
          opened.push(account.id)
        } catch {
          failures.push({
            id: account.id,
            error: 'The upstream website could not be opened.',
          })
        }
      }
      return failures.length ? { opened, results: failures } : { opened }
    }
    if (request.operation !== 'read') {
      throw new Error('Invalid helper operation.')
    }
    if (running.has(sender.tab.id)) {
      throw new Error('A website read is already running.')
    }
    const origins = [
      ...new Set(accounts.map((account) => `${new URL(account.url).origin}/*`)),
    ]
    if (!(await browser.permissions.contains({ origins }))) {
      const id = crypto.randomUUID()
      await browser.storage.session.set({
        [`job-${id}`]: {
          client_tab: sender.tab.id,
          client_origin: new URL(sender.tab.url).origin,
          request,
          created_at: Date.now(),
        } satisfies Job,
      })
      await browser.tabs.create({
        url: `${browser.runtime.getURL('approve.html')}#${id}`,
        active: true,
      })
      return { pending: true }
    }
    running.add(sender.tab.id)
    try {
      return await readAll(request)
    } finally {
      running.delete(sender.tab.id)
    }
  }
  return { handle }
}
