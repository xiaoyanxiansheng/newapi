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
import { afterEach, describe, expect, test, vi } from 'vitest'

import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { MarketListingRow } from '../components/market-listing-row'
import { MarketModelRow } from '../components/market-model-row'
import type { MarketActions, MarketModel } from '../types'

const model: MarketModel = {
  model_name: 'model-with-a-long-name-for-an-AI-application',
  model_ratio: 1,
  completion_ratio: 4,
  quota_type: 0,
  min_ratio: 0.5,
  channels: [
    {
      channel_id: 7,
      listing_id: 1,
      ratio: 0.5,
      joined: false,
      position: 0,
      score: { total: 92, price: 80, stability: 99, speed: 88, cache: 0 },
    },
  ],
}
function actions(tokenId: number | null): MarketActions {
  return { tokenId, busy: false, onJoin: vi.fn(), onLeave: vi.fn() }
}

afterEach(() => {
  useAuthStore.getState().auth.reset()
})

test.each([ROLE.ADMIN, ROLE.SUPER_ADMIN])(
  'administrator role %s sees the website name / channel name / listing ID in the model plaza',
  (role) => {
    useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role })
    const channel = {
      ...model.channels[0],
      website_name: 'CCTQ',
      channel_name: 'cc-asw',
    }
    render(
      <MarketListingRow
        model={model}
        channel={channel}
        variant='model'
        actions={actions(1)}
      />
    )
    expect(screen.getByText('CCTQ / cc-asw / ID00001')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: model.model_name })
    ).toBeInTheDocument()
  }
)

test('ordinary users see only the listing ID even if previously cached administrator channel names exist', () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 2, username: 'user', role: ROLE.USER })
  const channel = {
    ...model.channels[0],
    website_name: 'CCTQ',
    channel_name: 'cc-asw',
  }
  render(
    <MarketListingRow
      model={model}
      channel={channel}
      variant='model'
      actions={actions(1)}
    />
  )
  expect(screen.getByText('ID00001')).toBeInTheDocument()
  expect(screen.queryByText(/CCTQ/)).not.toBeInTheDocument()
  expect(screen.queryByText(/cc-asw/)).not.toBeInTheDocument()
})

test('administrators see channel and ID without an empty separator when the website is unavailable', () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'admin', role: ROLE.ADMIN })
  render(
    <MarketListingRow
      model={model}
      channel={{ ...model.channels[0], channel_name: 'cc-asw' }}
      variant='model'
      actions={actions(1)}
    />
  )
  expect(screen.getByText('cc-asw / ID00001')).toBeInTheDocument()
})

describe('model cards', () => {
  test.each([
    ['claude-opus-5-5@s1c13', 'claude-opus-5-5'],
    ['gpt-6.1-high@s46c260', 'gpt-6.1-high'],
    ['gpt-6.1-xhigh@s46c260', 'gpt-6.1-xhigh'],
  ])(
    '%s listing hides the supplier suffix in its title and copies the full access name',
    async (accessName, displayName) => {
      const user = userEvent.setup()
      render(
        <MarketModelRow
          model={{ ...model, model_name: accessName }}
          actions={actions(1)}
        />
      )
      expect(
        screen.getByRole('heading', { name: displayName })
      ).toHaveAttribute('title', displayName)
      await user.click(screen.getByRole('button', { name: 'Copy name' }))
      expect(await navigator.clipboard.readText()).toBe(accessName)
    }
  )

  test.each(['model', 'channel'] as const)(
    '%s listing applies the administrator empty-success setting without hiding failures',
    (variant) => {
      const window = {
        rate: 0.5,
        blocks: [
          { ok: 0, fail: 0 },
          { ok: 1, fail: 0 },
          { ok: 0, fail: 1 },
        ],
      }
      const channel = {
        ...model.channels[0],
        default_success: true,
        stats: {
          realtime: window,
          day: window,
          week: window,
          samples: 2,
          last_success_at: 0,
        },
      }
      const { rerender } = render(
        <MarketListingRow
          model={model}
          channel={channel}
          variant={variant}
          actions={actions(1)}
        />
      )
      const stripes = screen.getByRole('img', { name: /^Success rate:/ })
      for (const empty of within(stripes).getAllByTitle(
        'Success 0 / Failed 0'
      )) {
        expect(empty).toHaveClass('bg-success')
      }
      for (const failed of within(stripes).getAllByTitle(
        'Success 0 / Failed 1'
      )) {
        expect(failed).toHaveClass('bg-destructive')
      }
      expect(within(stripes).getAllByText('50%')).toHaveLength(3)
      rerender(
        <MarketListingRow
          model={model}
          channel={{ ...channel, default_success: false }}
          variant={variant}
          actions={actions(1)}
        />
      )
      for (const empty of within(stripes).getAllByTitle(
        'Success 0 / Failed 0'
      )) {
        expect(empty).toHaveClass('bg-muted-foreground/20')
      }
    }
  )
  test('shows monitoring for a testable Claude chat model', () => {
    render(
      <MarketModelRow
        model={{ ...model, model_name: 'vendor/Claude-Sonnet' }}
        actions={actions(1)}
      />
    )
    expect(screen.getByLabelText('Overall score 92')).toBeInTheDocument()
  })
  test.each(['model', 'channel'] as const)(
    '%s Claude listing hides status only when its own channel reports a CC restriction',
    (variant) => {
      const claude = { ...model, model_name: 'claude-sonnet' }
      const window = { rate: 0, blocks: [{ ok: 0, fail: 1 }] }
      const channel = {
        ...model.channels[0],
        abnormal: true,
        monitoring_available: true,
        stats: {
          realtime: window,
          day: window,
          week: window,
          samples: 1,
          last_success_at: 0,
          probe_usage: {
            total_tokens: 12717,
            samples: 3,
            average_tokens: 4239,
            estimated_samples: 0,
          },
        },
      }
      const { rerender } = render(
        <MarketListingRow
          model={claude}
          channel={channel}
          variant={variant}
          actions={actions(1)}
        />
      )
      expect(
        screen.getByRole('img', { name: /^Success rate:/ })
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Overall score 92')).toBeInTheDocument()
      expect(screen.getByText('Abnormal')).toBeInTheDocument()
      expect(
        within(
          screen.getByRole('group', { name: 'Token consumption' })
        ).getByText('High')
      ).toBeInTheDocument()
      rerender(
        <MarketListingRow
          model={claude}
          channel={{ ...channel, monitoring_available: false }}
          variant={variant}
          actions={actions(1)}
        />
      )
      expect(
        screen.queryByRole('img', { name: /^Success rate:/ })
      ).not.toBeInTheDocument()
      expect(screen.getByLabelText('Score not displayed')).toHaveTextContent(
        '—'
      )
      expect(screen.queryByText('Abnormal')).not.toBeInTheDocument()
      expect(
        within(
          screen.getByRole('group', { name: 'Token consumption' })
        ).getByText('—')
      ).toBeInTheDocument()
      rerender(
        <MarketListingRow
          model={claude}
          channel={channel}
          variant={variant}
          actions={actions(1)}
        />
      )
      expect(screen.getByLabelText('Overall score 92')).toBeInTheDocument()
    }
  )
  test('hides monitoring for per-request models even when a score exists', () => {
    const fields = { model_name: 'image-per-request', quota_type: 1 }
    render(
      <MarketModelRow model={{ ...model, ...fields }} actions={actions(1)} />
    )
    expect(screen.queryByLabelText('Overall score 92')).not.toBeInTheDocument()
    expect(
      screen.getByLabelText('Monitoring not displayed')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Score not displayed')).toHaveTextContent('—')
  })
  test('dynamic listings show their actual selling multiplier and channel description', () => {
    const channel = {
      ...model.channels[0],
      ratio: 1,
      price_ratio: 0.242,
      billing_mode: 'tiered_expr',
      billing_expr: 'tier("base", p * 0.484 + c * 2.42)',
      description: 'Stable channel with priority support',
    }
    render(
      <MarketModelRow
        model={{
          ...model,
          description: 'Generic model information',
          channels: [channel],
        }}
        actions={actions(1)}
      />
    )
    expect(screen.getByText(/0.242x/)).toBeInTheDocument()
    expect(screen.getByText(channel.description)).toBeInTheDocument()
    expect(screen.queryByText('Description')).not.toBeInTheDocument()
    expect(screen.getByText('Dynamic Pricing')).toBeInTheDocument()
  })
  test('shows output first with channel status, score and all comparable prices in a compact row', () => {
    render(
      <MarketModelRow
        model={model}
        actions={actions(1)}
        vendor={{ id: 1, name: 'Example AI' }}
      />
    )
    const card = screen.getByRole('article')
    expect(
      within(card).getByRole('heading', { name: model.model_name })
    ).toHaveAttribute('title', model.model_name)
    const labels = within(card).getAllByRole('term')
    expect(labels.map((label) => label.textContent)).toEqual([
      'Output /1M',
      'Input /1M',
      'Cache read /1M',
      'Cache write /1M',
    ])
    expect(screen.getByText('ID00001')).toBeInTheDocument()
    expect(screen.queryByText(/Channel #/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Overall score 92')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Toggle channels' })
    ).not.toBeInTheDocument()
  })

  test('joins the selected model channel through its primary action', async () => {
    const callbacks = actions(23)
    render(<MarketModelRow model={model} actions={callbacks} />)
    await userEvent.click(screen.getByRole('button', { name: 'Join route' }))
    expect(callbacks.onJoin).toHaveBeenCalledWith(model.model_name, 7, 1)
  })

  test('disables joining without an API key while keeping channel prices visible', () => {
    render(<MarketModelRow model={model} actions={actions(null)} />)
    expect(screen.getByRole('button', { name: 'Join route' })).toBeDisabled()
    expect(screen.getByText('Cache read /1M')).toBeInTheDocument()
  })
})
