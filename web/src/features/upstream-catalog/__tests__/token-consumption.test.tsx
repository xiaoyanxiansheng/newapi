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
import { expect, test, vi } from 'vitest'

import { CatalogTable } from '../components/catalog-table'
import type { CatalogRow } from '../types'

test('upstream administrators see token consumption in a separate column while keeping full model statistics', () => {
  const window = { rate: 1, blocks: [{ ok: 3, fail: 0 }] }
  const row: CatalogRow = {
    model: 'claude-test',
    latest: null,
    reviewed: null,
    change: 'unchanged',
    markup_override: '',
    listing: { id: 17, enabled: true, ratio: 1 },
    monitoring: {
      price_ratio: 1,
      default_success: false,
      score: null,
      stats: {
        realtime: window,
        day: window,
        week: window,
        samples: 3,
        last_success_at: 0,
        probe_usage: {
          total_tokens: 69,
          samples: 3,
          average_tokens: 23,
          estimated_samples: 0,
        },
      },
    },
  }
  render(
    <CatalogTable
      rows={[row]}
      selected={{}}
      busy={false}
      markup='1.1'
      onSelect={vi.fn()}
      onReview={vi.fn()}
    />
  )
  expect(
    screen.getByRole('columnheader', { name: 'Token consumption' })
  ).toBeInTheDocument()
  const usage = screen.getByRole('group', { name: 'Token consumption' })
  expect(within(usage).getByText('Very low')).toBeInTheDocument()
  expect(usage.closest('[data-section=details]')).not.toContainElement(
    screen.getByText('claude-test')
  )
  expect(
    screen.getByRole('img', { name: /^Success rate:/ })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('region', { name: 'Upstream model table' })
  ).not.toHaveClass('overflow-x-auto')
})

test('an administrator can select the native test protocol for a listed model', async () => {
  const onProbeEndpoint = vi.fn()
  const row: CatalogRow = {
    model: 'gpt-test',
    latest: null,
    reviewed: null,
    change: 'unchanged',
    markup_override: '',
    listing: { id: 17, enabled: true, ratio: 1, probe_endpoint: 'anthropic' },
  }
  render(
    <CatalogTable
      rows={[row]}
      selected={{}}
      busy={false}
      markup='1.1'
      onSelect={vi.fn()}
      onReview={vi.fn()}
      onProbeEndpoint={onProbeEndpoint}
    />
  )
  const select = screen.getByRole('combobox', {
    name: 'Test protocol for gpt-test',
  })
  expect(select).toHaveValue('anthropic')
  await userEvent.setup().selectOptions(select, 'openai-response')
  expect(onProbeEndpoint).toHaveBeenCalledWith('gpt-test', 'openai-response')
})
