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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, expect, test, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'

import { MarketModelSelector } from '../components/market-model-selector'
import { PriceGrid } from '../components/price-grid'
import type { MarketModel } from '../types'

const model: MarketModel = {
  model_name: 'reference-model',
  model_ratio: 10,
  completion_ratio: 4,
  cache_ratio: 0.1,
  create_cache_ratio: 1.25,
  quota_type: 0,
  min_ratio: 0.11,
  channels: [
    {
      channel_id: 1,
      listing_id: 1,
      ratio: 0.11,
      joined: false,
      position: 0,
    },
  ],
}

test('independently published fixed prices show frozen sale and original input output and zero cache prices', () => {
  const original = {
    ...model,
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("base", p * 20 + c * 80 + cr * 0)',
  }
  const channel = {
    ...model.channels[0],
    ratio: 1,
    billing_mode: 'fixed_expr',
    billing_expr: 'tier("base", p * 2.2 + c * 8.8 + cr * 0)',
  }
  render(
    <>
      <MarketModelSelector
        models={[original]}
        selected={null}
        onSelect={vi.fn()}
      />
      <section aria-label='Selling price'>
        <PriceGrid model={original} channel={channel} ratio={1} />
      </section>
    </>
  )
  const prices = screen.getByRole('group', { name: 'Original price' })
  expect(within(prices).getByText('$20')).toBeInTheDocument()
  expect(within(prices).getByText('$80')).toBeInTheDocument()
  const sale = screen.getByRole('region', { name: 'Selling price' })
  expect(within(sale).getByText('$2.2')).toBeInTheDocument()
  expect(within(sale).getByText('$8.8')).toBeInTheDocument()
  expect(within(sale).getByText('$0')).toBeInTheDocument()
})

afterEach(async () => {
  await i18n.changeLanguage('en')
  i18n.removeResourceBundle('zhCN', 'translation')
})

test('shows original input, output and cache prices independent of channel discounts', () => {
  const props = { models: [model], selected: null, onSelect: vi.fn() }
  const { rerender } = render(<MarketModelSelector {...props} />)
  const prices = screen.getByRole('group', { name: 'Original price' })
  for (const [label, value] of [
    ['Input /1M', '$20'],
    ['Output /1M', '$80'],
    ['Cache read /1M', '$2'],
    ['Cache write /1M', '$25'],
  ]) {
    const cell = within(prices).getByText(label).parentElement
    if (!cell) throw new Error('Missing original price cell')
    expect(within(cell).getByText(value)).toBeInTheDocument()
  }
  expect(within(prices).queryByText('$2.2')).not.toBeInTheDocument()
  rerender(
    <MarketModelSelector
      {...props}
      models={[
        {
          ...model,
          min_ratio: 0.5,
          channels: [{ ...model.channels[0], ratio: 0.5 }],
        },
      ]}
    />
  )
  expect(within(prices).getByText('$20')).toBeInTheDocument()
  expect(within(prices).getByText('$80')).toBeInTheDocument()
})

test('supplier route choices reuse the directly listed base model original prices without replacing route sale prices', () => {
  const base = { ...model, model_name: 'claude-opus-5-5' }
  render(
    <MarketModelSelector
      models={[
        { ...model, model_name: 'claude-opus-5-5@s1c13', model_ratio: 1 },
        { ...model, model_name: 'claude-opus-5-5@s46c260', model_ratio: 2 },
        base,
      ]}
      selected={null}
      onSelect={vi.fn()}
    />
  )
  expect(
    screen.getAllByRole('button', { name: /^claude-opus-5-5/ })
  ).toHaveLength(1)
  const prices = screen.getByRole('group', { name: 'Original price' })
  expect(within(prices).getByText('$20')).toBeInTheDocument()
  expect(within(prices).getByText('$80')).toBeInTheDocument()
})

test('shows original per-request prices with the correct unit', () => {
  render(
    <MarketModelSelector
      models={[{ ...model, quota_type: 1, model_price: 20 }]}
      selected={null}
      onSelect={vi.fn()}
    />
  )
  const prices = screen.getByRole('group', { name: 'Original price' })
  expect(within(prices).getByText('Per request')).toBeInTheDocument()
  expect(within(prices).getByText('$20')).toBeInTheDocument()
  expect(within(prices).queryByText('Output /1M')).not.toBeInTheDocument()
})

test('keeps missing cache prices distinct from configured zero and shows available media prices', () => {
  render(
    <MarketModelSelector
      models={[
        {
          ...model,
          cache_ratio: 0,
          create_cache_ratio: null,
          image_ratio: 2,
          audio_ratio: 3,
          audio_completion_ratio: 4,
        },
      ]}
      selected={null}
      onSelect={vi.fn()}
    />
  )
  const prices = screen.getByRole('group', { name: 'Original price' })
  for (const [label, value] of [
    ['Cache read /1M', '$0'],
    ['Cache write /1M', '—'],
    ['Image input /1M', '$40'],
    ['Audio input /1M', '$60'],
    ['Audio output /1M', '$240'],
  ]) {
    const cell = within(prices).getByText(label).parentElement
    if (!cell) throw new Error('Missing original price cell')
    expect(within(cell).getByText(value)).toBeInTheDocument()
  }
})

test.each([
  ['<=', '≤', '>'],
  ['<', '<', '≥'],
])(
  'shows the %s original price threshold and its exact complementary tier',
  (operator, symbol, fallback) => {
    render(
      <MarketModelSelector
        models={[
          {
            ...model,
            billing_mode: 'tiered_expr',
            billing_expr:
              'len ' +
              operator +
              ' 272000 ? tier("short", p * 20 + c * 80 + cr * 0 + cc * 25) : tier("long", p * 40 + c * 120 + cr * 4 + cc * 50)',
          },
        ]}
        selected={null}
        onSelect={vi.fn()}
      />
    )
    const prices = screen.getByRole('group', { name: 'Original price' })
    expect(within(prices).getByText('Tiered pricing')).toBeInTheDocument()
    expect(
      within(prices).getByRole('table', { name: 'Original price tiers' })
    ).toBeInTheDocument()
    expect(
      within(prices).getByText('Input context ' + symbol + ' 272K')
    ).toBeInTheDocument()
    expect(
      within(prices).getByText('Input context ' + fallback + ' 272K')
    ).toBeInTheDocument()
    expect(
      within(prices).getByText(/272K = 272,000 input tokens/)
    ).toBeInTheDocument()
    for (const value of [
      '$20',
      '$40',
      '$80',
      '$120',
      '$0',
      '$4',
      '$25',
      '$50',
    ]) {
      expect(within(prices).getByText(value)).toBeInTheDocument()
    }
  }
)

test('does not invent a fixed price for an unsupported dynamic expression or a missing request price', () => {
  render(
    <MarketModelSelector
      models={[
        {
          ...model,
          billing_mode: 'tiered_expr',
          billing_expr: 'p * c',
          model_name: 'dynamic-model',
        },
        {
          ...model,
          model_name: 'request-model',
          quota_type: 1,
          model_price: undefined,
        },
      ]}
      selected={null}
      onSelect={vi.fn()}
    />
  )
  const dynamic = screen.getByRole('button', { name: /^dynamic-model/ })
  expect(within(dynamic).getByText('Dynamic Pricing')).toBeInTheDocument()
  expect(within(dynamic).queryByText('$80')).not.toBeInTheDocument()
  expect(
    within(screen.getByRole('button', { name: /^request-model/ })).getByText(
      '—'
    )
  ).toBeInTheDocument()
})

test('preserves model selection and translates the original-price breakdown to Chinese', async () => {
  const onSelect = vi.fn()
  const { rerender } = render(
    <MarketModelSelector models={[model]} selected={null} onSelect={onSelect} />
  )
  const choice = screen.getByRole('button', { name: /^reference-model/ })
  await userEvent.click(choice)
  expect(onSelect).toHaveBeenCalledWith(model.model_name)
  rerender(
    <MarketModelSelector
      models={[model]}
      selected={model.model_name}
      onSelect={onSelect}
    />
  )
  expect(choice).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(choice)
  expect(onSelect).toHaveBeenLastCalledWith(null)
  i18n.addResourceBundle('zhCN', 'translation', zh.translation)
  await i18n.changeLanguage('zhCN')
  expect(
    await screen.findByRole('group', { name: '模型原价' })
  ).toBeInTheDocument()
  expect(screen.getByText('输入 /1M')).toBeInTheDocument()
  expect(screen.getByText('缓存读 /1M')).toBeInTheDocument()
})
