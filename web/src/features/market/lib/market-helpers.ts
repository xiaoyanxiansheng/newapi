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

import type { PricingModel, TokenUnit } from '@/features/pricing/types'
import { handleServerError } from '@/lib/handle-server-error'

import { MarketBusinessError } from '../api'
import type {
  MarketBlock,
  MarketChannel,
  MarketModel,
  MarketRegion,
  MarketVendor,
} from '../types'

const MARKET_RATIO_GROUP = 'market'

/** The plaza always quotes token prices per million tokens. */
export const MARKET_TOKEN_UNIT: TokenUnit = 'M'

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
  if (total <= 0) return 'none'
  return rateTone((block?.ok ?? 0) / total)
}

// ----------------------------------------------------------------------------
// Channel / model ordering
// ----------------------------------------------------------------------------

function compareByRatio(a: MarketChannel, b: MarketChannel): number {
  return a.ratio - b.ratio || a.channel_id - b.channel_id
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
  return typeof total === 'number' ? total : null
}

/**
 * Fixed plaza ordering: models joined by the key first, then the
 * representative channel's total score (null last), then the model name.
 */
export function sortMarketModels(models: MarketModel[]): MarketModel[] {
  return [...models].sort((a, b) => {
    const pinnedA = hasJoinedChannel(a)
    const pinnedB = hasJoinedChannel(b)
    if (pinnedA !== pinnedB) return pinnedA ? -1 : 1

    const scoreA = getTotalScore(a)
    const scoreB = getTotalScore(b)
    if (scoreA !== scoreB) {
      if (scoreA === null) return 1
      if (scoreB === null) return -1
      return scoreB - scoreA
    }
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
