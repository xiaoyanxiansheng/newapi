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
import type { MarketStats, MarketScore } from '@/features/market/types'

export type Prices = Partial<
  Record<
    | 'input'
    | 'output'
    | 'cache_read'
    | 'cache_write'
    | 'image_input'
    | 'audio_input'
    | 'audio_output'
    | 'request',
    string
  >
>
export type Quote = {
  listing_id?: number
  price_cny_per_usd?: string
  pricing_mode?: 'model_routes'
  base_model?: string
  channel_no?: string
  supplier_id?: number
  route_status?: string
  long_context_threshold?: number
  long_context_input_multiplier?: string
  long_context_output_multiplier?: string
  billing_mode?: string
  billing_expr?: string
  cost_expr?: string
  upstream_ratio?: string
  price_group?: string
  display_currency?: string
  model: string
  description?: string
  currency: string
  unit: string
  original: Prices
  cost: Prices
  price_issue?: string
}
export type Source = {
  pricing_mode?: 'model_routes' | ''
  key_used_cny?: string
  key_usage_read_time?: number
  disabled?: boolean
  account_disabled?: boolean
  account_id?: number
  remote_key_id?: number
  key_masked?: string
  key_status?: number
  key_missing?: boolean
  key_issue?: string
  key_expires_at?: number
  id: number
  name: string
  base_url: string
  catalog_url: string
  adapter: 'newapi' | 'catalog' | 'manual' | 'account' | 'direct-key'
  price_group: string
  purchase_multiplier: string
  markup: string
  channel_id: number
  revision: number
  latest_time: number
  last_error: string
  has_catalog_key: boolean
  has_relay_key: boolean
}
export type SourceInput = Omit<
  Source,
  | 'id'
  | 'revision'
  | 'latest_time'
  | 'last_error'
  | 'has_catalog_key'
  | 'has_relay_key'
> & {
  revision?: number
  catalog_key?: string
  relay_key?: string
}
export type CatalogRow = {
  model: string
  latest: Quote | null
  reviewed: Quote | null
  change: 'new' | 'changed' | 'removed' | 'unchanged'
  markup_override: string
  listing: {
    id: number
    ratio: number
    enabled: boolean
    description?: string
    billing_mode?: string
    default_success?: boolean
    probe_endpoint?: string
  } | null
  monitoring?: {
    price_ratio: number
    stats: MarketStats | null
    score: MarketScore | null
    default_success: boolean
  }
}
export type CatalogDetail = {
  source: Source
  rows: CatalogRow[]
  history: { id: number; created_time: number; revision: number }[]
}
export type CatalogFilters = {
  listingStatus: string
  onlyChanges: boolean
}
export type Selection = {
  revision: number
  models: Record<string, string>
  fingerprint?: string
}
export type Proposal = {
  billing_mode?: string
  billing_expr?: string
  original_expr?: string
  cost_expr?: string
  display_currency?: string
  model: string
  markup: string
  original: Prices
  cost: Prices
  sale: Prices
  unit: string
  ratio: number
  current_ratio: number
  listing_id: number
  enabled: boolean
  issue?: string
}
export type Preview = {
  fingerprint: string
  proposals: Proposal[]
  channel_name: string
  creates_channel: boolean
}

export type UpstreamAccount = {
  balance_cny?: string
  balance_read_time?: number
  balance_issue?: string
  balance_page_url?: string
  disabled?: boolean
  auth_type?: 'password' | 'browser' | ''
  has_session?: boolean
  remote_user_id?: number
  id: number
  name: string
  website: string
  key_page_url?: string
  discovery_mode?: 'newapi' | 'api' | 'page'
  discovery_recipe?: string
  discovery_time?: number
  username: string
  markup: string
  revision: number
  last_sync: number
  last_error: string
  workflow: string
}
export type AccountInput = Pick<UpstreamAccount, 'name' | 'markup'> & {
  balance_page_url?: string
  key_page_url?: string
  revision?: number
  auth_type: 'browser'
}
export type AccountDetail = { account: UpstreamAccount; keys: Source[] }
export type BalanceRefreshResults = Record<
  number,
  { status: 'pending' | 'success' | 'error'; error?: string }
>
export type ManualKeyInput = {
  name: string
  base_url: string
  key?: string
  markup: string
  revision?: number
}
export type ManualPrice = {
  model: string
  original: Prices
  cost: Prices
  currency: string
  unit: string
}

export type RouteQuote = {
  access_model: string
  supplier_id?: number
  channel_no?: string
  listing_id?: number
  unit: string
  prices: Prices
  original: Prices
  multiplier?: string
  multiplier_source?: string
  input_coefficient?: string
  output_coefficient?: string
  origin: string
  status?: string
  access_verified: boolean
  issue?: string
}
export type RouteQuotes = {
  read_only: boolean
  currency: 'CNY'
  source_id: number
  snapshot_time: number
  snapshot_stale: boolean
  quote_time: number
  origin: string
  model_count: number
  route_count: number
  issues: string[]
  models: { model: string; routes: RouteQuote[] }[]
}
