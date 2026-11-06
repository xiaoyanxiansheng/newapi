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
import { readFileSync } from 'node:fs'

import { render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { CatalogTable } from '../components/catalog-table'
import type { CatalogRow, Quote } from '../types'

const quote: Quote = {
  model: 'example',
  unit: 'per_million_tokens',
  currency: 'USD',
  display_currency: 'CNY',
  upstream_ratio: '0.22',
  original: { input: '2', output: '10', cache_read: '0.2', cache_write: '2.5' },
  cost: {
    input: '0.44',
    output: '2.2',
    cache_read: '0.044',
    cache_write: '0.55',
  },
}
function mount(latest: Quote | null = quote, reviewed: Quote | null = quote) {
  const row: CatalogRow = {
    model: 'example',
    latest,
    reviewed,
    change: 'changed',
    markup_override: '',
    listing: null,
  }
  return render(
    <CatalogTable
      rows={[row]}
      selected={{}}
      busy={false}
      markup='1.1'
      onSelect={vi.fn()}
      onReview={vi.fn()}
      onPublish={vi.fn()}
    />
  )
}

test('image group prices show a per-image amount without token input and output prices', () => {
  mount({
    ...quote,
    unit: 'per_image',
    original: { request: '0.05' },
    cost: { request: '0.05' },
  })
  const prices = screen.getByRole('group', { name: 'Upstream original prices' })
  expect(within(prices).getByText('CNY / image')).toBeVisible()
  expect(within(prices).getByText('Per image')).toBeVisible()
  expect(within(prices).getByText('¥0.05')).toBeVisible()
  expect(within(prices).queryByText('Input')).toBeNull()
  expect(within(prices).queryByText('CNY / 1M tokens')).toBeNull()
})

test('all admin model fields have visible labels in a wrapping layout without a wide scrolling table', () => {
  const css = readFileSync('src/styles/index.css', 'utf-8')
  const style = document.createElement('style')
  style.textContent =
    css.match(/[.]hwjai-catalog-table\s*[{][^}]+[}]/)?.[0] ?? ''
  document.head.append(style)
  try {
    mount()
    const table = screen.getByRole('table')
    expect(getComputedStyle(table).minWidth).toBe('0px')
    const scroll = screen.getByRole('region', { name: 'Upstream model table' })
    expect(scroll).not.toHaveClass('overflow-x-auto')
    expect(scroll).toHaveClass('min-w-0', 'max-w-full')
    const card = screen.getByRole('article', { name: 'example' })
    expect(within(card).getByText('example')).toBeVisible()
    expect(
      within(card).getByRole('checkbox', { name: 'Select example' })
    ).toBeVisible()
    for (const label of [
      'Model ID',
      'Token consumption',
      'Upstream multiplier',
      'Channel description',
      'Markup multiplier',
      'Actions',
      'Upstream original prices',
    ]) {
      expect(within(card).getByText(label)).toBeVisible()
    }
    expect(
      screen.getByRole('textbox', { name: 'Markup for example' })
    ).toBeVisible()
  } finally {
    style.remove()
  }
})

test.each([
  {
    name: 'fixed token prices',
    latest: quote,
    original: ['¥2', '¥10', '¥0.2', '¥2.5'],
    cost: ['¥0.44', '¥2.2', '¥0.044', '¥0.55'],
  },
  {
    name: 'per-request prices',
    latest: {
      ...quote,
      unit: 'per_request',
      original: { request: '1' },
      cost: { request: '0.22' },
    },
    original: ['¥1'],
    cost: ['¥0.22'],
  },
  {
    name: 'tiered prices',
    latest: {
      ...quote,
      billing_mode: 'tiered_expr',
      billing_expr:
        'len < 272000 ? tier("base", p * 5 + c * 25 + cr * 0.5) : tier("long", p * 10 + c * 37.5 + cr * 1)',
      cost_expr:
        'len < 272000 ? tier("base", p * 1.1 + c * 5.5 + cr * 0.11) : tier("long", p * 2.2 + c * 8.25 + cr * 0.22)',
    },
    original: ['¥5.0000', '¥25.0000', '¥10.0000', '¥37.5000'],
    cost: ['¥1.1000', '¥5.5000', '¥2.2000', '¥8.2500'],
  },
])(
  'admin table shows only the upstream multiplier and one expanded original column for $name',
  ({ latest, original, cost }) => {
    mount(latest)
    expect(
      screen.getByRole('columnheader', { name: 'Upstream multiplier' })
    ).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '0.22x' })).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Upstream original prices' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: 'Previously reviewed cost' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: 'Latest upstream prices' })
    ).not.toBeInTheDocument()
    const prices = screen.getByRole('group', {
      name: 'Upstream original prices',
    })
    expect(prices.closest('details')).toBeNull()
    for (const value of original) {
      expect(within(prices).getAllByText(value)[0]).toBeVisible()
    }
    for (const value of cost) {
      expect(screen.queryByText(value)).not.toBeInTheDocument()
    }
    if (latest.billing_mode === 'tiered_expr') {
      expect(within(prices).getAllByText(/272K/)[0]).toBeVisible()
    } else if (latest.unit === 'per_request') {
      expect(within(prices).getByText('CNY / request')).toBeInTheDocument()
    } else {
      expect(within(prices).getByText('CNY / 1M tokens')).toBeInTheDocument()
    }
  }
)

test('missing or unverified upstream prices keep publishing disabled and do not fall back to a calculated reviewed cost', () => {
  const { rerender } = mount({
    ...quote,
    price_issue: 'Confirm upstream pricing',
    original: {},
  })
  expect(screen.getByText('Confirm upstream pricing')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Publish model' })).toBeDisabled()
  expect(screen.queryByText('¥2.2')).not.toBeInTheDocument()
  rerender(
    <CatalogTable
      rows={[
        {
          model: 'example',
          latest: null,
          reviewed: quote,
          change: 'removed',
          markup_override: '',
          listing: null,
        },
      ]}
      selected={{}}
      busy={false}
      markup='1.1'
      onSelect={vi.fn()}
      onReview={vi.fn()}
      onPublish={vi.fn()}
    />
  )
  expect(screen.getByRole('button', { name: 'Publish model' })).toBeDisabled()
  expect(
    screen.queryByRole('group', { name: 'Upstream original prices' })
  ).not.toBeInTheDocument()
  expect(screen.queryByText('¥2.2')).not.toBeInTheDocument()
})
