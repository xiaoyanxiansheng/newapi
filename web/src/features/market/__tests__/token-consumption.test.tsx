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
import { expect, test } from 'vitest'

import { TokenConsumption } from '../components/token-consumption'

test.each([
  [69, 3, 'Very low'],
  [300, 3, 'Low'],
  [2997, 3, 'Low'],
  [3000, 3, 'High'],
  [12717, 3, 'High'],
  [29997, 3, 'High'],
  [30000, 3, 'Very high'],
] as const)(
  'a cumulative total of %s across %s probes shows %s based on the average',
  (total, samples, label) => {
    render(
      <TokenConsumption
        usage={{
          total_tokens: total,
          samples,
          average_tokens: total / samples,
          estimated_samples: 0,
        }}
      />
    )
    expect(
      within(
        screen.getByRole('group', { name: 'Token consumption' })
      ).getByText(label)
    ).toBeInTheDocument()
  }
)

test('missing probe usage stays unknown instead of showing a low consumption grade', () => {
  render(<TokenConsumption />)
  const group = screen.getByRole('group', { name: 'Token consumption' })
  expect(within(group).getByText('—')).toBeInTheDocument()
  expect(within(group).queryByText('Very low')).not.toBeInTheDocument()
})

test('the consumption detail opens from the keyboard and explains cumulative usage', async () => {
  render(
    <TokenConsumption
      usage={{
        total_tokens: 12717,
        samples: 3,
        average_tokens: 4239,
        estimated_samples: 0,
      }}
    />
  )
  const user = userEvent.setup()
  await user.tab()
  await user.keyboard('{Enter}')
  expect(
    screen.getByText('Last 7 days: 12,717 tokens across 3 successful probes.')
  ).toBeVisible()
  expect(
    screen.getByText(
      'Probe consumption is a reference for this channel and model, not your actual request usage.'
    )
  ).toBeVisible()
})

test('estimated totals never receive a consumption grade', () => {
  render(
    <TokenConsumption
      usage={{
        total_tokens: 20,
        samples: 1,
        average_tokens: 20,
        estimated_samples: 1,
      }}
    />
  )
  expect(screen.queryByText('Very low')).not.toBeInTheDocument()
})

test('an explicit zero returned by the upstream is known usage', () => {
  render(
    <TokenConsumption
      usage={{
        total_tokens: 0,
        samples: 1,
        average_tokens: 0,
        estimated_samples: 0,
      }}
    />
  )
  expect(screen.getByRole('button', { name: 'Very low' })).toBeInTheDocument()
})

test('the usage dialog preserves unknown cache fields and shows reasoning without adding it to the total', async () => {
  render(
    <TokenConsumption
      usage={{
        total_tokens: 4239,
        samples: 1,
        estimated_samples: 0,
        average_tokens: 4239,
        protocol: 'openai-response',
        unknown_samples: 1,
        recent: [
          {
            id: 1,
            at: 1791340000,
            profile: 'ok-256-stream-v1',
            protocol: 'openai-response',
            success: true,
            output_limited: false,
            input_tokens: 4000,
            output_tokens: 239,
            cache_read_tokens: null,
            cache_write_tokens: null,
            reasoning_tokens: 238,
            total_tokens: 4239,
            total_source: 'upstream',
          },
        ],
      }}
    />
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'High' }))
  const dialog = screen.getByRole('dialog', { name: 'Token consumption' })
  expect(dialog).toHaveClass('overflow-y-auto')
  expect(within(dialog).getAllByText('Unknown')).toHaveLength(2)
  expect(within(dialog).getByText('238')).toBeVisible()
  expect(within(dialog).getByText('4,239')).toBeVisible()
  expect(
    within(dialog).getByText(
      '1 successful probes have unknown usage and are excluded from the grade.'
    )
  ).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('a successful probe with no reported usage remains unknown and still opens its record', async () => {
  render(
    <TokenConsumption
      usage={{
        total_tokens: 0,
        samples: 0,
        estimated_samples: 0,
        average_tokens: 0,
        recent: [
          {
            id: 1,
            at: 1791340000,
            profile: 'ok-256-stream-v1',
            protocol: 'openai',
            success: true,
            output_limited: false,
            input_tokens: null,
            output_tokens: null,
            cache_read_tokens: null,
            cache_write_tokens: null,
            reasoning_tokens: null,
            total_tokens: null,
            total_source: '',
          },
        ],
      }}
    />
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Unknown' }))
  expect(
    within(screen.getByRole('dialog')).getAllByText('Unknown')
  ).toHaveLength(6)
  expect(
    screen.queryByRole('button', { name: 'Very low' })
  ).not.toBeInTheDocument()
})
