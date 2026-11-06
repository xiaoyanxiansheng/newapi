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
import { describe, expect, test } from 'vitest'

import {
  blockTone,
  buildVendorSections,
  formatListingId,
  formatRatio,
  getMarketBaseModelName,
  sortChannelsForDisplay,
  sortMarketModels,
} from '../lib/market-helpers'
import type { MarketChannel, MarketModel, MarketVendor } from '../types'

function channel(overrides: Partial<MarketChannel>): MarketChannel {
  return {
    channel_id: 1,
    listing_id: 1,
    ratio: 1,
    joined: false,
    position: 0,
    ...overrides,
  }
}

function model(name: string, channels: MarketChannel[], vendorId = 1) {
  return {
    model_name: name,
    vendor_id: vendorId,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    min_ratio: channels[0]?.ratio ?? 0,
    channels,
  } as MarketModel
}

function scored(total: number | null, joined = false): MarketChannel {
  return channel({
    joined,
    position: joined ? 1 : 0,
    score: { price: 50, stability: null, speed: null, cache: 0, total },
  })
}

describe('formatters', () => {
  test.each([
    ['claude-opus-5-5@s1c13', 'claude-opus-5-5'],
    ['claude-opus-5-5@s46c260', 'claude-opus-5-5'],
    ['gpt-6.1-sol-high@s1c35', 'gpt-6.1-sol-high'],
    ['gpt-6.1-sol-xhigh@s1c35', 'gpt-6.1-sol-xhigh'],
    ['claude-opus-5-5', 'claude-opus-5-5'],
    ['model@private', 'model@private'],
    ['model@s1c13-preview', 'model@s1c13-preview'],
    ['minimax-m3@s61c310', 'MiniMax-M3'],
    ['minimax-m3', 'MiniMax-M3'],
    ['MiniMax-M3', 'MiniMax-M3'],
  ])(
    'model choice %s removes only a recognized supplier route suffix and preserves model levels',
    (accessName, expected) => {
      expect(getMarketBaseModelName(accessName)).toBe(expected)
    }
  )

  test('pads the listing id to five digits', () => {
    expect(formatListingId(235)).toBe('ID00235')
    expect(formatListingId(123456)).toBe('ID123456')
  })

  test('trims trailing zeros of the ratio', () => {
    expect(formatRatio(0.035)).toBe('0.035x')
    expect(formatRatio(2)).toBe('2x')
  })
})

describe('blockTone', () => {
  test('uses gray without samples and thresholds 0.95 / 0.7', () => {
    expect(blockTone(undefined)).toBe('none')
    expect(blockTone({ ok: 0, fail: 0 })).toBe('none')
    expect(blockTone({ ok: 19, fail: 1 })).toBe('good')
    expect(blockTone({ ok: 7, fail: 3 })).toBe('warn')
    expect(blockTone({ ok: 1, fail: 1 })).toBe('bad')
  })
})

describe('sortChannelsForDisplay', () => {
  test('puts joined channels first by position, then ratio ascending', () => {
    const sorted = sortChannelsForDisplay([
      channel({ channel_id: 1, ratio: 0.1 }),
      channel({ channel_id: 2, ratio: 0.5, joined: true, position: 2 }),
      channel({ channel_id: 3, ratio: 0.3, joined: true, position: 1 }),
      channel({ channel_id: 4, ratio: 0.05 }),
    ])
    expect(sorted.map((item) => item.channel_id)).toEqual([3, 2, 4, 1])
  })
})

describe('sortMarketModels', () => {
  test('defaults to descending score regardless of joined state, with null last', () => {
    const sorted = sortMarketModels([
      model('b-null', [scored(null)]),
      model('a-low', [scored(40)]),
      model('c-high', [scored(90)]),
      model('d-pinned', [scored(10, true)]),
      model('a-null', [scored(null)]),
    ])
    expect(sorted.map((item) => item.model_name)).toEqual([
      'c-high',
      'a-low',
      'd-pinned',
      'a-null',
      'b-null',
    ])
  })

  test('supports ascending representative price sorting', () => {
    const sorted = sortMarketModels(
      [
        model('expensive', [channel({ ratio: 2 })]),
        model('cheap', [channel({ ratio: 0.2 })]),
      ],
      'price'
    )
    expect(sorted.map((item) => item.model_name)).toEqual([
      'cheap',
      'expensive',
    ])
  })

  test('sorts by output price even when input prices would reverse the order', () => {
    const expensiveOutput = {
      ...model('expensive-output', [channel({ ratio: 0.2, joined: true })]),
      completion_ratio: 20,
    }
    const cheapOutput = {
      ...model('cheap-output', [channel({ ratio: 1 })]),
      completion_ratio: 1,
    }
    expect(
      sortMarketModels([expensiveOutput, cheapOutput], 'price').map(
        (item) => item.model_name
      )
    ).toEqual(['cheap-output', 'expensive-output'])
  })

  test('puts free output first and missing output prices last', () => {
    const free = { ...model('free', [channel({})]), completion_ratio: 0 }
    const unknown = {
      ...model('unknown', [channel({})]),
      completion_ratio: Number.NaN,
    }
    expect(
      sortMarketModels(
        [unknown, model('paid', [channel({})]), free],
        'price'
      ).map((item) => item.model_name)
    ).toEqual(['free', 'paid', 'unknown'])
  })

  test('uses the quoted first tier output price for dynamic models', () => {
    const dynamic = {
      ...model('dynamic', [channel({ ratio: 0.5 })]),
      billing_mode: 'tiered_expr',
      billing_expr: '(p * 2 + c * 8) / 1000000',
    }
    expect(
      sortMarketModels(
        [dynamic, model('standard', [channel({})])],
        'price'
      ).map((item) => item.model_name)
    ).toEqual(['standard', 'dynamic'])
  })

  test('keeps per-request prices separate from per-million-token output prices', () => {
    const request = {
      ...model('per-request', [channel({})]),
      quota_type: 1,
      model_price: 0.001,
    }
    expect(
      sortMarketModels([request, model('token', [channel({})])], 'price').map(
        (item) => item.model_name
      )
    ).toEqual(['token', 'per-request'])
  })
})

describe('buildVendorSections', () => {
  test('groups by region, skips empty vendors and unassigned when empty', () => {
    const vendors: MarketVendor[] = [
      { id: 1, name: 'OpenAI', region: 'intl' },
      { id: 2, name: 'DeepSeek', region: 'cn' },
      { id: 3, name: 'Empty', region: 'cn' },
    ]
    const sections = buildVendorSections(vendors, [
      model('gpt', [channel({}), channel({ channel_id: 2 })], 1),
      model('ds', [channel({})], 2),
    ])
    expect(sections.map((section) => section.region)).toEqual(['intl', 'cn'])
    expect(sections[0].vendors[0].channelCount).toBe(2)
    expect(sections[1].vendors).toHaveLength(1)
  })

  test('treats a missing region as unassigned', () => {
    const sections = buildVendorSections(
      [{ id: 1, name: 'Mystery' }],
      [model('m', [channel({})], 1)]
    )
    expect(sections.map((section) => section.region)).toEqual([''])
  })
})
