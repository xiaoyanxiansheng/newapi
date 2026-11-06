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
import { AxiosError } from 'axios'

import {
  getDynamicPricingTiers,
  isDynamicPricingModel,
} from '@/features/pricing/lib/dynamic-price'
import type { PricingModel, TokenUnit } from '@/features/pricing/types'
import { handleServerError } from '@/lib/handle-server-error'

import { MarketBusinessError } from '../api'
import type {
  MarketBlock,
  MarketChannel,
  MarketModel,
  MarketRegion,
  MarketStatsWindow,
  MarketVendor,
} from '../types'

const MARKET_RATIO_GROUP = 'market'

/** The plaza always quotes token prices per million tokens. */
export const MARKET_TOKEN_UNIT: TokenUnit = 'M'

/** Display grouping only; routing and billing keep the full access model name. */
export function getMarketBaseModelName(name: string): string {
  const baseName = /^(.+)@s[1-9][0-9]*c[1-9][0-9]*$/.exec(name)?.[1] ?? name
  return baseName.toLowerCase() === 'minimax-m3' ? 'MiniMax-M3' : baseName
}

/**
 * Adapt a market model to the pricing model shape so the existing pricing
 * helpers can be reused. The channel ratio plays the role of the old group
 * ratio.
 */
export function toPricingModel(
  model: MarketModel,
  ratio: number
): PricingModel {
  return {
    ...model,
    id: model.id ?? 0,
    enable_groups: [MARKET_RATIO_GROUP],
    group_ratio: { [MARKET_RATIO_GROUP]: ratio },
  }
}

export function toListingPricingModel(
  model: MarketModel,
  channel: MarketChannel
): PricingModel {
  const pricing = toPricingModel(
    { ...model, ...channel.pricing },
    channel.ratio
  )
  if (
    channel.billing_mode === 'tiered_expr' ||
    channel.billing_mode === 'fixed_expr'
  ) {
    return {
      ...pricing,
      billing_mode: 'tiered_expr',
      billing_expr: channel.billing_expr,
      quota_type: 0,
      group_ratio: { [MARKET_RATIO_GROUP]: 1 },
    }
  }
  return pricing
}

// ----------------------------------------------------------------------------
// Formatting
// ----------------------------------------------------------------------------

export function formatListingId(listingId: number): string {
  return `ID${String(Math.max(0, Math.trunc(listingId || 0))).padStart(5, '0')}`
}

/** Ratio without the unit, e.g. 0.035 */
export function formatRatioValue(ratio: number): string {
  if (!Number.isFinite(ratio)) return '-'
  return String(Number.parseFloat(ratio.toFixed(6)))
}

/** Ratio with the unit, e.g. 0.035x */
export function formatRatio(ratio: number): string {
  return Number.isFinite(ratio) ? `${formatRatioValue(ratio)}x` : '-'
}

export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '-'
  return `${Number.parseFloat((rate * 100).toFixed(1))}%`
}

// ----------------------------------------------------------------------------
// Success rate tones
// ----------------------------------------------------------------------------

export type RateTone = 'none' | 'good' | 'warn' | 'bad'

export function rateTone(rate: number | null | undefined): RateTone {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) {
    return 'none'
  }
  if (rate >= 0.95) return 'good'
  if (rate >= 0.7) return 'warn'
  return 'bad'
}

export const TONE_BG_CLASS: Record<RateTone, string> = {
  none: 'bg-muted-foreground/20',
  good: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
}

export const TONE_TEXT_CLASS: Record<RateTone, string> = {
  none: 'text-muted-foreground',
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-destructive',
}

export function blockTone(block: MarketBlock | undefined): RateTone {
  const total = (block?.ok ?? 0) + (block?.fail ?? 0)
  if (total <= 0) return rateTone(block?.inherited_rate)
  return rateTone((block?.ok ?? 0) / total)
}

/** Real request rate when available; otherwise the retained realtime state. */
export function windowDisplayRate(window?: MarketStatsWindow): number | null {
  if (window?.rate != null) return window.rate
  return window?.blocks.at(-1)?.inherited_rate ?? null
}

// ----------------------------------------------------------------------------
// Channel / model ordering
// ----------------------------------------------------------------------------

function compareByRatio(a: MarketChannel, b: MarketChannel): number {
  return (
    (a.output_price ?? a.ratio) - (b.output_price ?? b.ratio) ||
    a.channel_id - b.channel_id
  )
}

/** Joined channels first (by route position), then the rest by ratio. */
export function sortChannelsForDisplay(
  channels: MarketChannel[]
): MarketChannel[] {
  const joined = channels
    .filter((channel) => channel.joined)
    .sort((a, b) => a.position - b.position || compareByRatio(a, b))
  const others = channels
    .filter((channel) => !channel.joined)
    .sort(compareByRatio)
  return [...joined, ...others]
}

/** The lowest-price channel represents the model in the collapsed row. */
export function getRepresentativeChannel(
  model: MarketModel
): MarketChannel | undefined {
  return model.channels?.[0]
}

export function hasJoinedChannel(model: MarketModel): boolean {
  return (model.channels ?? []).some((channel) => channel.joined)
}

function getTotalScore(model: MarketModel): number | null {
  const total = getRepresentativeChannel(model)?.score?.total
  return typeof total === 'number' && Number.isFinite(total) ? total : null
}

/** Output USD per million tokens, or USD per request for fixed-price models. */
export function getRepresentativePrice(model: MarketModel): number | null {
  const channel = getRepresentativeChannel(model)
  if (!channel) return null
  if (
    typeof channel.output_price === 'number' &&
    Number.isFinite(channel.output_price)
  ) {
    return channel.output_price
  }
  let price: number
  const listing = toListingPricingModel(model, channel)
  if (isDynamicPricingModel(listing)) {
    const output = getDynamicPricingTiers(listing)[0]?.outputPrice
    price = typeof output === 'number' ? output * channel.ratio : Number.NaN
  } else if (model.quota_type === 1) {
    price =
      typeof model.model_price === 'number'
        ? model.model_price * channel.ratio
        : Number.NaN
  } else {
    price = model.model_ratio * 2 * model.completion_ratio * channel.ratio
  }
  return Number.isFinite(price) && price >= 0 ? price : null
}

/** Score descending by default; output price ascending, with distinct billing units grouped. */
export type MarketSort = 'score' | 'price' | 'listed'

export function sortMarketModels(
  models: MarketModel[],
  sort: MarketSort = 'score'
): MarketModel[] {
  return [...models].sort((a, b) => {
    const sortValue = (model: MarketModel): number | null => {
      if (sort === 'price') return getRepresentativePrice(model)
      if (sort === 'listed') {
        return getRepresentativeChannel(model)?.listed_at ?? 0
      }
      return getTotalScore(model)
    }
    const valueA = sortValue(a)
    const valueB = sortValue(b)
    if (valueA === null && valueB !== null) return 1
    if (valueB === null && valueA !== null) return -1
    if (sort === 'price' && valueA !== null && valueB !== null) {
      const unitA = a.quota_type === 1 ? 1 : 0
      const unitB = b.quota_type === 1 ? 1 : 0
      if (unitA !== unitB) return unitA - unitB
    }
    if (valueA !== valueB) {
      if (valueA === null) return 1
      if (valueB === null) return -1
      return sort === 'price' ? valueA - valueB : valueB - valueA
    }
    const pinnedA = hasJoinedChannel(a)
    const pinnedB = hasJoinedChannel(b)
    if (pinnedA !== pinnedB) return pinnedA ? -1 : 1
    return (a.model_name || '').localeCompare(b.model_name || '')
  })
}

export function filterMarketModels(
  models: MarketModel[],
  search: string,
  vendorId: number | null
): MarketModel[] {
  const query = search.trim().toLowerCase()
  return models.filter((model) => {
    if (vendorId !== null && model.vendor_id !== vendorId) return false
    if (!query) return true
    return (
      model.model_name?.toLowerCase().includes(query) ||
      model.description?.toLowerCase().includes(query)
    )
  })
}

// ----------------------------------------------------------------------------
// Brand sections
// ----------------------------------------------------------------------------

export type VendorCard = {
  vendor: MarketVendor
  channelCount: number
}

export type VendorSection = {
  region: MarketRegion
  vendors: VendorCard[]
}

const REGION_ORDER: MarketRegion[] = ['intl', 'cn', '']

/**
 * Group the vendors that have at least one model by region. Empty sections
 * (including the unassigned one) are omitted.
 */
export function buildVendorSections(
  vendors: MarketVendor[],
  models: MarketModel[]
): VendorSection[] {
  const channelCounts = new Map<number, number>()
  const modelCounts = new Map<number, number>()
  for (const model of models) {
    if (model.vendor_id === undefined || model.vendor_id === null) continue
    modelCounts.set(
      model.vendor_id,
      (modelCounts.get(model.vendor_id) ?? 0) + 1
    )
    channelCounts.set(
      model.vendor_id,
      (channelCounts.get(model.vendor_id) ?? 0) + (model.channels?.length ?? 0)
    )
  }

  const sections = REGION_ORDER.map<VendorSection>((region) => ({
    region,
    vendors: [],
  }))
  for (const vendor of vendors) {
    if (!modelCounts.get(vendor.id)) continue
    const region: MarketRegion =
      vendor.region === 'intl' || vendor.region === 'cn' ? vendor.region : ''
    const section = sections.find((item) => item.region === region)
    section?.vendors.push({
      vendor,
      channelCount: channelCounts.get(vendor.id) ?? 0,
    })
  }

  // The backend lists vendors in map order; keep the cards in a stable order.
  for (const section of sections) {
    section.vendors.sort(
      (a, b) =>
        b.channelCount - a.channelCount ||
        a.vendor.name.localeCompare(b.vendor.name)
    )
  }

  return sections.filter((section) => section.vendors.length > 0)
}

/**
 * Axios errors and `success: false` responses are already toasted by the HTTP
 * client interceptor; anything else goes through the shared handler.
 */
export function reportMarketError(error: unknown): void {
  if (error instanceof AxiosError || error instanceof MarketBusinessError) {
    return
  }
  handleServerError(error)
}
