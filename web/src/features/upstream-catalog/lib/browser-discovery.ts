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
export type DiscoveryRecipe = {
  kind: 'newapi' | 'api' | 'page'
  list_path?: string
  page_start?: number
  key_selector?: string
  models_path?: string
}
export type DiscoveredKey = {
  joined_routes_issue?: string
  joined_routes?: Array<{
    listing_id: number
    base_model?: string
    listing_alias?: string
    blocked?: boolean
  }>
  used_cny?: string
  id: number
  name: string
  key: string
  group: string
  group_id?: number
  status: number
  models: string[] | null
  expires_at: number
}
export type BrowserDiscovery = {
  reader_version?: number
  balance_cny?: string
  balance_issue?: 'not_found'
  money_only?: boolean
  page_url: string
  connector: DiscoveryRecipe
  identity: { id: number; username: string; email: string }
  keys: DiscoveredKey[]
  complete: boolean
  pricing?: unknown
  status?: unknown
  sub2api_pricing?: {
    catalog: unknown
    group_rates: unknown
    available_groups?: unknown
  }
}

// Self-contained because the same function runs inside the user's authorized
// upstream tab. It never sends cookies to hwjai, creates Keys, or edits them.
export async function discoverUpstreamPage(
  recipe?: DiscoveryRecipe,
  allowSelection = false,
  labels?: Record<string, string>,
  funds?: {
    balance_page_url?: string
    money_only?: boolean
    expected_origin?: string
  }
): Promise<BrowserDiscovery> {
  if (funds?.expected_origin && location.origin !== funds.expected_origin) {
    throw new Error(
      'The upstream page could not be read. Complete its login and retry authorization.'
    )
  }
  const messages = {
    intro:
      'hwjai could not find a complete Key automatically. Select its area below. Reveal hidden Keys on the website first.',
    pick: 'Select the Key area',
    cancel: 'Cancel',
    choose:
      'Click the existing Key text or input. This click only selects the area and does not activate the original page action.',
    retry:
      'The selected area has no complete Key. Reveal the Key first or select its actual text or input again.',
    noKeys:
      'No readable existing Keys were found. Reveal a Key on this page, then click the authorization bookmark again.',
    ...labels,
  }
  type ObjectValue = Record<string, unknown>
  const record = (value: unknown): ObjectValue =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as ObjectValue)
      : {}
  const secret = (value: unknown): string =>
    typeof value === 'string' &&
    value.length >= 12 &&
    value.length <= 4096 &&
    !/[*\s•●…]|\.\.\./.test(value)
      ? value
      : ''
  const stableId = (value: string): number => {
    let hash = 2166136261
    for (let index = 0; index < value.length; index++) {
      hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
    }
    return ((hash >>> 0) % 2147483646) + 1
  }
  let userId = 0
  let bearer = ''
  let isSub2Api = false
  let identity = { id: 0, username: '', email: '' }
  try {
    const user = record(JSON.parse(localStorage.getItem('user') || '{}'))
    if (Number.isSafeInteger(user.id) && Number(user.id) > 0) {
      userId = Number(user.id)
    }
    identity = {
      id: userId,
      username: String(user.username || '').slice(0, 255),
      email: String(user.email || '').slice(0, 255),
    }
  } catch {
    /* Sites may restrict storage or use only HttpOnly cookies. */
  }
  try {
    // Sub2API stores its existing bearer session separately from New API.
    // Keep it inside the authorized tab and verify the user through auth/me.
    const token = localStorage.getItem('auth_token') || ''
    const user = record(JSON.parse(localStorage.getItem('auth_user') || '{}'))
    if (
      token &&
      token.length <= 16384 &&
      Number.isSafeInteger(user.id) &&
      Number(user.id) > 0
    ) {
      isSub2Api = true
      bearer = token
      userId = 0
      identity = { id: 0, username: '', email: '' }
    }
  } catch {
    /* A missing or inaccessible session falls back to cookie/page reading. */
  }
  const requestIssues = new Map<string, string>()
  const request = async (
    path: string,
    reveal = false,
    body?: ObjectValue
  ): Promise<unknown> => {
    const url = new URL(path, location.origin)
    if (url.origin !== location.origin || url.username || url.password) {
      return null
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
    }
    if (reveal) headers['Content-Type'] = 'application/json'
    if (userId > 0 && !isSub2Api) headers['New-Api-User'] = String(userId)
    if (bearer && (!isSub2Api || url.pathname.startsWith('/api/v1/'))) {
      headers.Authorization = `Bearer ${bearer}`
    }
    try {
      const response = await fetch(url.pathname + url.search, {
        method: reveal ? 'POST' : 'GET',
        credentials: 'include',
        headers,
        ...(reveal ? { body: JSON.stringify(body ?? {}) } : {}),
        signal: AbortSignal.timeout(12000),
        redirect: 'error',
      })
      if (!response.ok) {
        requestIssues.set(path, `http_${response.status}`)
        return null
      }
      const text = await response.text()
      if (text.length > 8 * 1024 * 1024) {
        requestIssues.set(path, 'response_too_large')
        return null
      }
      const data: unknown = JSON.parse(text)
      if (
        record(data).success === false ||
        (isSub2Api && record(data).code !== 0)
      ) {
        requestIssues.set(path, 'upstream_rejected')
        return null
      }
      return data
    } catch {
      requestIssues.set(path, 'request_failed')
      return null
    }
  }
  let self = record(
    record(await request(isSub2Api ? '/api/v1/auth/me' : '/api/user/self')).data
  )
  if (!isSub2Api && (!Number.isSafeInteger(self.id) || Number(self.id) <= 0)) {
    // Newer New API uses short-lived bearer sessions. Older versions are read
    // directly with the existing cookie and never need this optional step.
    const refreshed = record(
      record(await request('/api/user/auth/refresh', true)).data
    )
    if (
      typeof refreshed.access_token === 'string' &&
      refreshed.access_token.length <= 16384
    ) {
      bearer = refreshed.access_token
      const user = record(refreshed.user)
      if (Number.isSafeInteger(user.id) && Number(user.id) > 0) {
        userId = Number(user.id)
      }
      self = record(record(await request('/api/user/self')).data)
    }
  }
  if (Number.isSafeInteger(self.id) && Number(self.id) > 0) {
    userId = Number(self.id)
    identity = {
      id: userId,
      username: String(self.username || '').slice(0, 255),
      email: String(self.email || '').slice(0, 255),
    }
  }
  const status = isSub2Api ? null : await request('/api/status')
  const billing = record(record(status).data)
  const currency = String(billing.quota_display_type || '').toUpperCase()
  const isRMB = currency === 'CNY' || currency === 'RMB'
  const amount = (raw: unknown): string | undefined => {
    if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
    const value = String(raw)
      .trim()
      .replace(/^[¥￥]\s*/, '')
      .replaceAll(',', '')
    return /^-?[0-9]{1,16}(?:\.[0-9]{1,8})?$/.test(value) ? value : undefined
  }
  // Use only the site's own RMB display settings for its raw quota fields.
  const quotaAmount = (raw: unknown): string | undefined => {
    if (raw === null || raw === undefined || raw === '') return undefined
    const quota = Number(raw)
    const unit = Number(billing.quota_per_unit)
    const exchange = Number(billing.usd_exchange_rate)
    if (
      !isRMB ||
      !Number.isSafeInteger(quota) ||
      !Number.isFinite(unit) ||
      unit <= 0 ||
      !Number.isFinite(exchange) ||
      exchange <= 0
    ) {
      return undefined
    }
    const displayed = (quota / unit) * exchange
    return Number.isFinite(displayed) ? amount(displayed.toFixed(2)) : undefined
  }
  const usedQuotaAmount = (value: ObjectValue): string | undefined => {
    const usage = record(value.usage ?? value.stats ?? value.quota_usage)
    const candidates: Array<{ raw: unknown; isQuota: boolean }> = [
      { raw: value.used_cny, isQuota: false },
      { raw: value.used_amount_cny, isQuota: false },
      { raw: value.used_quota, isQuota: true },
      { raw: value.usedQuota, isQuota: true },
      { raw: value.used_amount, isQuota: false },
      { raw: value.consumed_cny, isQuota: false },
      { raw: value.consumed_quota, isQuota: true },
      { raw: value.consumed, isQuota: true },
      { raw: value.quota_used, isQuota: true },
      { raw: value.total_used, isQuota: true },
      { raw: value.spent, isQuota: true },
      { raw: value.spent_quota, isQuota: true },
      { raw: usage.used_cny, isQuota: false },
      { raw: usage.used_amount_cny, isQuota: false },
      { raw: usage.used_quota, isQuota: true },
      { raw: usage.usedQuota, isQuota: true },
      { raw: usage.consumed, isQuota: true },
      { raw: usage.spent, isQuota: true },
    ]
    for (const candidate of candidates) {
      const direct = candidate.isQuota
        ? quotaAmount(candidate.raw)
        : amount(candidate.raw)
      if (direct !== undefined) return direct
      const quota = candidate.isQuota ? undefined : quotaAmount(candidate.raw)
      if (quota !== undefined) return quota
    }
    return undefined
  }
  const labelledAmount = (
    root: ParentNode,
    label: string
  ): string | undefined => {
    const pattern = new RegExp(
      `(?:${label})\\s*[:：]?\\s*(?:[¥￥]\\s*)?(-?[0-9,]+(?:\\.[0-9]{1,8})?)`,
      'i'
    )
    for (const element of root.querySelectorAll('*')) {
      if (
        element.matches('script,style,button') ||
        element.closest('script,style,button')
      ) {
        continue
      }
      const text = (element.textContent || '').trim().replaceAll(/\s+/g, ' ')
      if (text.length > 300) continue
      const match = text.match(pattern)
      if (match) return amount(match[1])
    }
    return undefined
  }
  const rowUsedAmount = (row: Element): string | undefined => {
    const labelled = labelledAmount(
      row,
      '已用额度|已消费|累计消费|消费金额|used\\s*quota|used|spent|consumed'
    )
    if (labelled !== undefined) return labelled
    const table = row.closest('table')
    const cells = [...row.children].filter(
      (cell) =>
        cell.tagName === 'TH' ||
        cell.tagName === 'TD' ||
        cell.getAttribute('role') === 'cell'
    )
    if (!cells.length) return undefined
    const headers = table
      ? [
          ...table.querySelectorAll(
            'thead tr:first-child > th, thead tr:first-child > td'
          ),
        ]
      : []
    const readCell = (cell: Element | undefined): string | undefined => {
      if (!cell) return undefined
      const text = (cell.textContent || '').trim().replaceAll(/\s+/g, ' ')
      const match = text.match(
        /^(?:[¥￥]\s*)?(-?[0-9]{1,16}(?:,[0-9]{3})*(?:\.[0-9]{1,8})?)$/
      )
      return match ? amount(match[1]) : undefined
    }
    const headerIndex = headers.findIndex((header) =>
      /已用|消费|spent|used|consum/i.test(header.textContent || '')
    )
    if (headerIndex >= 0) {
      const direct = readCell(cells[headerIndex])
      if (direct !== undefined) return direct
    }
    const quotaIndex = headers.findIndex((header) =>
      /额度|quota|credit/i.test(header.textContent || '')
    )
    if (quotaIndex >= 0) {
      for (const cell of cells.slice(quotaIndex, quotaIndex + 3)) {
        const direct = readCell(cell)
        if (direct !== undefined) return direct
      }
    }
    return undefined
  }
  const balanceLabel =
    '账户余额|账号余额|当前余额|可用余额|余额|account\\s*balance|available\\s*balance|balance'
  const jsonBalance = (raw: unknown): string | undefined => {
    let value = record(raw)
    if (
      value.success === false ||
      (isSub2Api && 'code' in value && value.code !== 0)
    ) {
      return undefined
    }
    for (let depth = 0; depth < 4; depth++) {
      const explicit = amount(value.balance_cny ?? value.balance_rmb)
      if (explicit !== undefined) return explicit
      for (const field of [
        'balance',
        'available_balance',
        'remaining_balance',
      ]) {
        const candidate = value[field]
        const unit = String(
          value.currency || value.currency_code || ''
        ).toUpperCase()
        if (
          unit === 'CNY' ||
          unit === 'RMB' ||
          (typeof candidate === 'string' && /^[¥￥]/.test(candidate.trim()))
        ) {
          const parsed = amount(candidate)
          if (parsed !== undefined) return parsed
        }
      }
      const nested = value.data ?? value.wallet ?? value.account
      if (!nested || typeof nested !== 'object') break
      value = record(nested)
    }
    return undefined
  }
  let balance =
    (isSub2Api ? amount(self.balance) : undefined) ??
    jsonBalance(self) ??
    quotaAmount(self.quota) ??
    labelledAmount(document, balanceLabel)
  if (balance === undefined) {
    const paths = new Set<string>()
    if (funds?.balance_page_url) paths.add(funds.balance_page_url)
    for (const resource of performance.getEntriesByType('resource')) {
      if (
        /\/(?:api|dashboard|console)\/.*(?:balance|wallet|credit)(?:\/|\?|$)/i.test(
          resource.name
        )
      ) {
        paths.add(resource.name)
      }
    }
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      'a[href]'
    )) {
      if (/(?:余额|钱包|balance|wallet)/i.test(link.textContent || '')) {
        paths.add(link.href)
      }
    }
    const balanceDeadline = Date.now() + 12000
    for (const path of [...paths].slice(0, 8)) {
      if (Date.now() >= balanceDeadline) break
      try {
        const url = new URL(path, location.origin)
        if (
          url.origin !== location.origin ||
          url.username ||
          url.password ||
          /(?:logout|delete|create|refund|withdraw|transfer|reset)/i.test(
            url.pathname
          )
        ) {
          continue
        }
        const headers: Record<string, string> = {
          Accept: 'application/json,text/html',
          'Cache-Control': 'no-store',
        }
        if (userId > 0 && !isSub2Api) headers['New-Api-User'] = String(userId)
        if (bearer && (!isSub2Api || url.pathname.startsWith('/api/v1/'))) {
          headers.Authorization = `Bearer ${bearer}`
        }
        const response = await fetch(url.pathname + url.search, {
          method: 'GET',
          headers,
          credentials: 'include',
          redirect: 'error',
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(5000, balanceDeadline - Date.now()))
          ),
        })
        if (!response.ok) continue
        const text = await response.text()
        if (text.length > 8 * 1024 * 1024) continue
        if (text.trim().startsWith('{')) balance = jsonBalance(JSON.parse(text))
        else {
          balance = labelledAmount(
            new DOMParser().parseFromString(text, 'text/html'),
            balanceLabel
          )
        }
        if (balance !== undefined) break
      } catch {
        // A missing wallet page must not interrupt an authorized Key read.
      }
    }
  }
  const observedFunds =
    balance === undefined
      ? { balance_issue: 'not_found' as const }
      : { balance_cny: balance }
  if (funds?.money_only) {
    let kind: DiscoveryRecipe['kind'] = 'page'
    if (isSub2Api) kind = 'api'
    else if (identity.id > 0) kind = 'newapi'
    return {
      page_url: location.href,
      connector: { kind },
      identity,
      keys: [],
      complete: false,
      money_only: true,
      ...observedFunds,
    }
  }
  const unpack = (
    raw: unknown
  ): { items: unknown[]; total?: number } | null => {
    let data: unknown = raw
    for (let depth = 0; depth < 3; depth++) {
      if (Array.isArray(data)) return { items: data }
      const value = record(data)
      for (const name of ['items', 'tokens', 'keys', 'api_keys', 'results']) {
        if (Array.isArray(value[name])) {
          const total = Number(value.total ?? value.count ?? value.total_count)
          return {
            items: value[name] as unknown[],
            ...(Number.isSafeInteger(total) && total >= 0 ? { total } : {}),
          }
        }
      }
      if (!('data' in value)) return null
      data = value.data
    }
    return null
  }
  const normalize = (raw: unknown, isNewApi: boolean): DiscoveredKey | null => {
    const entry = record(raw)
    let key = secret(entry.key ?? entry.api_key ?? entry.secret ?? entry.token)
    if (key && !key.startsWith('sk-') && isNewApi) key = `sk-${key}`
    const rawId = entry.id ?? entry.token_id ?? entry.key_id
    let id = 0
    if (
      Number.isSafeInteger(Number(rawId)) &&
      Number(rawId) > 0 &&
      Number(rawId) <= 2147483647
    ) {
      id = Number(rawId)
    } else if (rawId) id = stableId(String(rawId))
    else if (key) id = stableId(key)
    if (
      !id ||
      !(
        entry.key !== undefined ||
        entry.api_key !== undefined ||
        entry.secret !== undefined ||
        entry.token !== undefined
      )
    ) {
      return null
    }
    let limits: string[] | null = null
    if (entry.model_limits_enabled) {
      limits = String(entry.model_limits || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    } else if (Array.isArray(entry.models)) {
      limits = entry.models.filter(
        (value): value is string => typeof value === 'string'
      )
    }
    let keyStatus = Number(entry.status ?? (entry.enabled === false ? 2 : 1))
    let expiresAt = Number(entry.expired_time ?? entry.expires_at ?? 0) || 0
    let group = String(entry.group ?? entry.price_group ?? '')
    if (isSub2Api) {
      keyStatus = entry.status === 'active' ? 1 : 2
      group = String(record(entry.group).name ?? entry.group_id ?? '')
      if (typeof entry.expires_at === 'string') {
        expiresAt = Math.floor(Date.parse(entry.expires_at) / 1000) || 0
      }
    }
    return {
      id,
      name: String(entry.name ?? entry.label ?? `Key ${id}`).slice(0, 255),
      key,
      group: group.slice(0, 255),
      ...(isSub2Api &&
      Number.isSafeInteger(Number(entry.group_id ?? record(entry.group).id)) &&
      Number(entry.group_id ?? record(entry.group).id) > 0
        ? { group_id: Number(entry.group_id ?? record(entry.group).id) }
        : {}),
      status: keyStatus,
      models: limits,
      expires_at: expiresAt,
      used_cny: usedQuotaAmount(entry),
    }
  }
  const safeListPath = (path: string): boolean => {
    try {
      const url = new URL(path, location.origin)
      return (
        url.origin === location.origin &&
        !url.username &&
        !url.password &&
        /^\/(api|dashboard|console)\//.test(url.pathname) &&
        /(?:^|\/)(?:tokens?|keys?|api[-_]keys?)(?:\/|$)/i.test(url.pathname) &&
        !/(?:delete|create|revoke|reset|logout|new|edit)/i.test(url.pathname)
      )
    } catch {
      return false
    }
  }
  const paths = isSub2Api
    ? ['/api/v1/keys?page=1&page_size=100']
    : [
        '/api/token/?p=1&size=100',
        '/api/token/?p=0&size=100',
        '/api/keys',
        '/api/api-keys',
        '/api/tokens',
      ]
  if (recipe?.list_path && safeListPath(recipe.list_path)) {
    if (!isSub2Api) paths.unshift(recipe.list_path)
  }
  for (const resource of performance.getEntriesByType('resource')) {
    if (safeListPath(resource.name)) {
      const url = new URL(resource.name)
      if (isSub2Api) continue
      let pageName = ''
      if (url.searchParams.has('p')) pageName = 'p'
      else if (url.searchParams.has('page')) pageName = 'page'
      if (pageName) {
        for (const firstPage of [0, 1]) {
          url.searchParams.set(pageName, String(firstPage))
          paths.push(url.pathname + url.search)
        }
      } else paths.push(url.pathname + url.search)
    }
  }
  let listed: BrowserDiscovery | null = null
  for (const path of [...new Set(paths)].slice(0, 20)) {
    const url = new URL(path, location.origin)
    const isNewApi =
      url.pathname === '/api/token/' || url.pathname === '/api/token'
    const first = unpack(await request(path))
    if (
      !first ||
      (first.items.length > 0 &&
        !first.items.some((item) => normalize(item, isNewApi)))
    ) {
      continue
    }
    if (isNewApi && identity.id <= 0) continue
    // Legacy New API returns a bare array and uses zero-based pagination.
    if (
      isNewApi &&
      first.total === undefined &&
      url.searchParams.get('p') === '1'
    ) {
      continue
    }
    const keys: DiscoveredKey[] = []
    const seen = new Set<number>()
    let complete = false
    let page = Number(
      url.searchParams.get('p') ?? url.searchParams.get('page') ?? 0
    )
    const start = page
    let batch: typeof first | null = first
    let expectedTotal = first.total
    for (let attempts = 0; attempts < 100 && batch; attempts++) {
      if (
        batch.total !== undefined &&
        expectedTotal !== undefined &&
        batch.total !== expectedTotal
      ) {
        break
      }
      expectedTotal ??= batch.total
      let repeated = false
      for (const item of batch.items) {
        const key = normalize(item, isNewApi)
        if (!key || seen.has(key.id)) {
          repeated = true
          continue
        }
        seen.add(key.id)
        if (!key.key && isNewApi) {
          const revealed = record(
            await request(`/api/token/${key.id}/key`, true)
          ).data
          key.key = secret(
            typeof revealed === 'string' ? revealed : record(revealed).key
          )
          if (!key.key) {
            const detail = record(await request(`/api/token/${key.id}`)).data
            key.key = secret(record(detail).key)
          }
          if (key.key && !key.key.startsWith('sk-')) key.key = `sk-${key.key}`
        }
        if (!key.key && isSub2Api) {
          const detail = record(
            record(await request(`/api/v1/keys/${key.id}`)).data
          )
          key.key = secret(detail.key)
        }
        keys.push(key)
      }
      if (repeated || keys.length > 10000) break
      if (expectedTotal !== undefined && keys.length === expectedTotal) {
        complete = true
        break
      }
      if (expectedTotal !== undefined && keys.length > expectedTotal) break
      if (batch.items.length === 0) {
        complete = expectedTotal === undefined || keys.length === expectedTotal
        break
      }
      if (!url.searchParams.has('p') && !url.searchParams.has('page')) break
      url.searchParams.set(
        url.searchParams.has('p') ? 'p' : 'page',
        String(++page)
      )
      batch = unpack(await request(url.pathname + url.search))
    }
    const missingUsage = keys.filter(
      (key) => isNewApi && key.used_cny === undefined
    )
    await Promise.all(
      missingUsage.map(async (key) => {
        const detail = record(
          record(await request(`/api/token/${key.id}`)).data
        )
        const used = usedQuotaAmount(detail)
        if (used !== undefined) key.used_cny = used
      })
    )
    if (isSub2Api) {
      // This is the same read-only usage query used by the website Key table.
      // quota_used can be reset, so it is not the cumulative actual cost.
      for (let offset = 0; offset < keys.length; offset += 100) {
        const batch = keys.slice(offset, offset + 100)
        const usage = record(
          record(
            await request('/api/v1/usage/dashboard/api-keys-usage', true, {
              api_key_ids: batch.map((key) => key.id),
            })
          ).data
        )
        const stats = record(usage.stats)
        for (const key of batch) {
          key.used_cny = amount(record(stats[String(key.id)]).total_actual_cost)
        }
      }
      complete = complete && keys.every((key) => !!key.key)
    }
    if (!keys.length && !complete) continue
    listed = {
      page_url: location.href,
      connector: {
        kind: isNewApi ? 'newapi' : 'api',
        list_path: path,
        page_start: start,
      },
      identity,
      keys,
      complete,
    }
    break
  }
  let selector =
    recipe?.key_selector ||
    'input[readonly],textarea[readonly],code,pre,[data-api-key],[data-key]'
  let selectedRegion = !!recipe?.key_selector
  const visibleKeys = (): DiscoveredKey[] => {
    const keys: DiscoveredKey[] = []
    const seen = new Set<string>()
    const add = (key: string, element: Element) => {
      if (!secret(key) || seen.has(key)) return
      seen.add(key)
      const row = element.closest('tr,[role="row"],li,article') || element
      const name =
        row.querySelector('td,[role="cell"],h3,h4')?.textContent?.trim() ||
        `Key ${keys.length + 1}`
      keys.push({
        id: stableId(key),
        name: name.slice(0, 255),
        key,
        group: '',
        status: 1,
        models: null,
        expires_at: 0,
        used_cny: rowUsedAmount(row),
      })
    }
    let elements: NodeListOf<Element>
    try {
      elements = document.querySelectorAll(selector)
    } catch {
      elements = document.querySelectorAll('code,input[readonly]')
    }
    for (const element of elements) {
      const value =
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
          ? element.value
          : element.getAttribute('data-api-key') ||
            element.getAttribute('data-key') ||
            element.textContent ||
            ''
      for (const key of value.match(
        /sk-[A-Za-z0-9_-]{12,4093}(?![A-Za-z0-9_*•●….-])/g
      ) || []) {
        add(key, element)
      }
      if (
        (element.hasAttribute('data-api-key') ||
          element.hasAttribute('data-key')) &&
        secret(value.trim())
      ) {
        add(value.trim(), element)
      }
      const keyInput =
        (element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement) &&
        /key|token|secret/i.test(
          `${element.name} ${element.id} ${
            element.getAttribute('aria-label') || ''
          }`
        )
      if (
        (keyInput || selectedRegion) &&
        /^[A-Za-z0-9_+=/.-]{16,4096}$/.test(value.trim()) &&
        secret(value.trim())
      ) {
        add(value.trim(), element)
      }
    }
    for (const row of document.querySelectorAll('tr,[role="row"]')) {
      const textNodes = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = textNodes.nextNode())) {
        const element = node.parentElement
        if (
          !element ||
          element.closest('button,[role="button"],a,script,style')
        ) {
          continue
        }
        for (const key of (node.textContent || '').match(
          /sk-[A-Za-z0-9_-]{12,4093}(?![A-Za-z0-9_*•●….-])/g
        ) || []) {
          add(key, element)
        }
      }
    }
    return keys
  }
  let clickedControls = new Set<Element>()
  const revealVisibleKeys = () => {
    // Only explicit reveal controls are clicked. Create/edit/delete/copy actions
    // are never part of this fallback and the clipboard is left untouched.
    for (const button of document.querySelectorAll(
      'button,[role="button"],[aria-label="eye"],[class*="icon-eye"]'
    )) {
      const label = (
        button.getAttribute('aria-label') ||
        button.getAttribute('title') ||
        button.textContent ||
        ''
      ).trim()
      const revealLabel =
        /^(?:show|reveal|view)\s*(?:api\s*)?(?:key|secret|token)$|^(?:显示|查看|展开)(?:密钥|秘钥|Key|key|令牌)$/i.test(
          label
        )
      const eye =
        (label === 'eye' ||
          !!button.querySelector(
            '[class*="icon-eye"],svg[class*="eye"],[data-icon="eye"]'
          ) ||
          button.classList.contains('semi-icon-eye')) &&
        !!button.closest('tr,[role="row"]')
      if (
        (revealLabel || eye) &&
        !button.hasAttribute('disabled') &&
        button.getAttribute('aria-disabled') !== 'true'
      ) {
        const control =
          button.closest('button,[role="button"]') ||
          (button instanceof HTMLElement ? button : button.parentElement)
        if (control instanceof HTMLElement && !clickedControls.has(control)) {
          clickedControls.add(control)
          control.click()
        }
      }
    }
  }
  if (
    !listed ||
    listed.keys.some((key) => !key.key || key.used_cny === undefined)
  ) {
    revealVisibleKeys()
    await new Promise<void>((resolve) => {
      const deadline = Date.now() + 2000
      const check = () => {
        if (visibleKeys().length || Date.now() >= deadline) resolve()
        else setTimeout(check, 100)
      }
      check()
    })
    const pageKeys = visibleKeys()
    if (!listed && pageKeys.length) {
      const seen = new Set(pageKeys.map((key) => key.id))
      for (let page = 0; page < 100; page++) {
        const next = [
          ...document.querySelectorAll('button,[role="button"]'),
        ].find(
          (button) =>
            /^(?:next(?: page)?|下一页)$/i.test(
              (
                button.getAttribute('aria-label') ||
                button.getAttribute('title') ||
                button.textContent ||
                ''
              ).trim()
            ) &&
            !button.hasAttribute('disabled') &&
            button.getAttribute('aria-disabled') !== 'true'
        )
        if (!(next instanceof HTMLElement)) break
        const before = visibleKeys()
          .map((key) => key.id)
          .join(',')
        next.click()
        clickedControls = new Set<Element>()
        const moved = await new Promise<boolean>((resolve) => {
          const deadline = Date.now() + 4000
          const check = () => {
            revealVisibleKeys()
            const values = visibleKeys()
            if (
              values.length &&
              values.map((key) => key.id).join(',') !== before
            ) {
              resolve(true)
            } else if (Date.now() >= deadline) resolve(false)
            else setTimeout(check, 100)
          }
          check()
        })
        if (!moved) break
        for (const key of visibleKeys()) {
          if (!seen.has(key.id)) {
            seen.add(key.id)
            pageKeys.push(key)
          }
        }
        if (pageKeys.length >= 10000) break
      }
    }
    if (listed) {
      // Complete secrets can be matched to masked API rows by their visible ends.
      for (const key of listed.keys) {
        if (!key.key || key.used_cny === undefined) {
          const matching = pageKeys.filter(
            (candidate) => candidate.name === key.name
          )
          if (
            matching.length === 1 &&
            listed.keys.filter((other) => other.name === key.name).length === 1
          ) {
            if (!key.key) key.key = matching[0].key
            if (key.used_cny === undefined) key.used_cny = matching[0].used_cny
          }
        }
      }
    } else if (pageKeys.length) {
      listed = {
        page_url: location.href,
        connector: { kind: 'page', key_selector: selector },
        identity,
        keys: pageKeys,
        complete: false,
      }
    }
  }
  if (!listed && allowSelection) {
    const picked = await new Promise<DiscoveredKey[]>((resolve, reject) => {
      const panel = document.createElement('div')
      panel.style.cssText =
        'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:18px;border:1px solid #bbb;border-radius:12px;background:white;color:#111;box-shadow:0 4px 24px #0003;font:14px sans-serif'
      const note = document.createElement('p')
      note.textContent = messages.intro
      const pick = document.createElement('button')
      pick.textContent = messages.pick
      const cancel = document.createElement('button')
      cancel.textContent = messages.cancel
      panel.append(note, pick, cancel)
      document.body.append(panel)
      let choosing = false
      const timer = setTimeout(() => finish(), 120000)
      const finish = (keys?: DiscoveredKey[]) => {
        clearTimeout(timer)
        document.removeEventListener('click', choose, true)
        panel.remove()
        if (keys?.length) resolve(keys)
        else reject(new Error(messages.noKeys))
      }
      const choose = (event: MouseEvent) => {
        if (
          !choosing ||
          !(event.target instanceof Element) ||
          panel.contains(event.target)
        ) {
          return
        }
        event.preventDefault()
        event.stopImmediatePropagation()
        choosing = false
        const element =
          event.target.closest('input,textarea,code,pre') || event.target
        const parts: string[] = []
        let current: Element | null = element
        for (let depth = 0; current && depth < 6; depth++) {
          if (current.id) {
            parts.unshift(`#${CSS.escape(current.id)}`)
            break
          }
          const siblings = current.parentElement
            ? [...current.parentElement.children].filter(
                (child) => child.tagName === current?.tagName
              )
            : [current]
          parts.unshift(
            `${current.tagName.toLowerCase()}:nth-of-type(${
              siblings.indexOf(current) + 1
            })`
          )
          current = current.parentElement
        }
        selector = parts.join(' > ')
        selectedRegion = true
        const keys = visibleKeys()
        if (keys.length) finish(keys)
        else note.textContent = messages.retry
      }
      document.addEventListener('click', choose, true)
      pick.addEventListener('click', () => {
        choosing = true
        note.textContent = messages.choose
      })
      cancel.addEventListener('click', () => finish())
    })
    listed = {
      page_url: location.href,
      connector: { kind: 'page', key_selector: selector },
      identity,
      keys: picked,
      complete: false,
    }
  }
  if (!listed) throw new Error(messages.noKeys)
  if (isSub2Api) {
    const catalog = await request('/api/v1/model-plaza')
    const groupRates = await request('/api/v1/groups/rates')
    const availableGroups = await request('/api/v1/groups/available')
    // Rates are queried separately because the plaza may silently fall back
    // to default group rates when its user-specific rate lookup fails.
    listed.sub2api_pricing = {
      catalog,
      group_rates: groupRates,
      available_groups: availableGroups,
    }
  }
  if (recipe?.models_path) listed.connector.models_path = recipe.models_path
  const pricing = isSub2Api ? null : await request('/api/pricing')
  if (pricing) listed.pricing = pricing
  const pinsPath = '/api/marketplace/pins'
  const pins = isSub2Api ? undefined : record(await request(pinsPath)).data
  const pinID = (value: unknown): number => {
    if (
      typeof value !== 'number' &&
      !(typeof value === 'string' && /^[0-9]+$/.test(value))
    ) {
      return 0
    }
    const id = Number(value)
    return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : 0
  }
  const listIssue = requestIssues.get(pinsPath) || 'invalid_response'
  for (const key of listed.keys) {
    if (
      !Array.isArray(pins) ||
      pins.length > 10000 ||
      pins.some((value) => !pinID(record(value).token_id))
    ) {
      key.joined_routes_issue = listIssue
      continue
    }
    const own = pins.filter((value) => pinID(record(value).token_id) === key.id)
    const seen = new Set<number>()
    const routes: NonNullable<DiscoveredKey['joined_routes']> = []
    for (const value of own) {
      const pin = record(value)
      const id = pinID(pin.listing_id)
      const base = pin.base_model
      const alias = pin.listing_alias
      const optionalText = (text: unknown): boolean =>
        text === undefined ||
        text === null ||
        text === '' ||
        (typeof text === 'string' && text.length <= 255)
      if (
        !id ||
        seen.has(id) ||
        !optionalText(base) ||
        !optionalText(alias) ||
        (alias &&
          (typeof alias !== 'string' ||
            !/^.+@s[1-9][0-9]*c[1-9][0-9]*$/.test(alias))) ||
        (base &&
          alias &&
          typeof alias === 'string' &&
          !alias.startsWith(`${base}@s`)) ||
        (pin.blocked !== undefined &&
          pin.blocked !== null &&
          typeof pin.blocked !== 'boolean')
      ) {
        key.joined_routes_issue = 'invalid_key_routes'
        break
      }
      seen.add(id)
      routes.push({
        listing_id: id,
        ...(typeof base === 'string' && base ? { base_model: base } : {}),
        ...(typeof alias === 'string' && alias ? { listing_alias: alias } : {}),
        blocked: pin.blocked === true,
      })
    }
    if (!key.joined_routes_issue) key.joined_routes = routes
  }
  listed.reader_version = 2
  if (status) listed.status = status
  Object.assign(listed, observedFunds)
  if (JSON.stringify(listed).length > 8 * 1024 * 1024) {
    throw new Error('The Key page response is too large to import.')
  }
  return listed
}
