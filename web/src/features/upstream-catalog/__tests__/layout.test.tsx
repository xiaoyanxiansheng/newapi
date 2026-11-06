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
import { assert, expect, test, vi } from 'vitest'

import { CatalogTable } from '../components/catalog-table'

test('wide admin cards keep monitoring and prices in two columns with publishing across the full next row', () => {
  const css = readFileSync('src/styles/index.css', 'utf-8')
  const style = document.createElement('style')
  style.textContent = css.slice(
    css.indexOf('.hwjai-catalog-scroll'),
    css.indexOf('.hwjai-brand-intl')
  )
  document.head.append(style)
  try {
    assert(style.sheet, 'Catalog layout stylesheet must be loaded')
    const rules = [...style.sheet.cssRules]
    const wide = rules.find(
      (rule) =>
        'conditionText' in rule && rule.conditionText === '(min-width: 900px)'
    ) as CSSGroupingRule
    const body = [...wide.cssRules].find(
      (rule) => (rule as CSSStyleRule).selectorText === '.hwjai-catalog-body'
    ) as CSSStyleRule
    expect(
      body.style.getPropertyValue('grid-template-columns').match(/minmax\(/g)
    ).toHaveLength(2)
    const publishing = rules.find(
      (rule) =>
        (rule as CSSStyleRule).selectorText === '.hwjai-catalog-publishing'
    ) as CSSStyleRule
    expect(publishing.style.getPropertyValue('grid-column')).toBe('1 / -1')
  } finally {
    style.remove()
  }
})

test('admin price tiers use available width and publishing buttons wrap instead of requiring horizontal scrolling', () => {
  const css = readFileSync('src/styles/index.css', 'utf-8')
  const style = document.createElement('style')
  style.textContent = css.slice(
    css.indexOf('.hwjai-catalog-scroll'),
    css.indexOf('.hwjai-brand-intl')
  )
  document.head.append(style)
  try {
    assert(style.sheet, 'Catalog layout stylesheet must be loaded')
    const rules = [...style.sheet.cssRules] as CSSStyleRule[]
    const tiers = rules.find(
      (rule) =>
        rule.selectorText === '.hwjai-catalog-prices .hwjai-pricing-tier-cards'
    )
    assert(tiers, 'Admin price tier layout must be defined')
    expect(tiers.style.display).toBe('grid')
    expect(tiers.style.getPropertyValue('grid-template-columns')).toContain(
      'repeat(auto-fit,'
    )
    expect(tiers.style.getPropertyValue('grid-template-columns')).toContain(
      'min(100%,'
    )
    const actions = rules.find(
      (rule) =>
        rule.selectorText === '.hwjai-catalog-field.hwjai-catalog-actions'
    )
    assert(actions, 'Publishing action layout must be defined')
    expect(actions.style.getPropertyValue('flex-wrap')).toBe('wrap')
    const body = rules.find(
      (rule) => rule.selectorText === '.hwjai-catalog-body'
    )
    assert(body, 'Admin model layout must be defined')
    expect(
      body.style.getPropertyValue('grid-template-columns').match(/minmax\(/g)
    ).toHaveLength(1)
  } finally {
    style.remove()
  }
})

test('a listed model keeps identity, monitoring, original prices and publishing controls grouped on one card', () => {
  render(
    <CatalogTable
      rows={[
        {
          model: 'gpt-layout',
          listing: {
            id: 4,
            ratio: 0.242,
            enabled: true,
            description: 'Channel description.',
          },
          latest: {
            model: 'gpt-layout',
            upstream_ratio: '0.22',
            original: { input: '10', output: '50' },
            cost: {},
            unit: 'per_million_tokens',
            currency: 'USD',
            display_currency: 'CNY',
          },
          change: 'unchanged',
          reviewed: null,
          markup_override: '',
        },
      ]}
      selected={{}}
      busy={false}
      markup='1.1'
      onSelect={vi.fn()}
      onReview={vi.fn()}
      onPublish={vi.fn()}
      onState={vi.fn()}
    />
  )
  const card = screen.getByRole('article', { name: 'gpt-layout' })
  const header = card.querySelector('header')
  assert(header, 'Model card must have an identity header')
  expect(
    within(header).getByRole('checkbox', { name: 'Select gpt-layout' })
  ).toBeVisible()
  expect(within(header).getByText('ID00004')).toBeVisible()
  expect(within(header).getByText('0.22x')).toBeVisible()
  expect(card.querySelector('[data-section=details]')).toBeInTheDocument()
  expect(
    within(card).getByRole('group', {
      name: /Channel monitoring for gpt-layout/,
    })
  ).toBeVisible()
  const footer = card.querySelector('footer')
  assert(footer, 'Model card must have publishing controls')
  expect(within(card).getByText('Channel description.')).toBeVisible()
  expect(
    card.querySelector('[data-section=publishing]')?.contains(footer)
  ).toBe(true)
  expect(
    within(footer).getByRole('textbox', { name: 'Markup for gpt-layout' })
  ).toBeVisible()
  expect(
    within(footer).getByRole('button', { name: 'Update selling price' })
  ).toBeVisible()
  expect(
    within(footer).getByRole('button', { name: 'Pause listing' })
  ).toBeVisible()
  expect(
    within(card).getByRole('group', { name: 'Upstream original prices' })
  ).toBeVisible()
})
