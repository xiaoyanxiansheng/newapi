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
import { render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh.json'

import { SuccessStripes } from '../components/success-stripes'
import type { MarketStats } from '../types'

const stats: MarketStats = {
  samples: 2,
  last_success_at: 1000,
  realtime: {
    rate: 0.5,
    blocks: [
      { ok: 0, fail: 0 },
      { ok: 1, fail: 0 },
      { ok: 0, fail: 0, inherited_rate: 1 },
      { ok: 0, fail: 1 },
      { ok: 0, fail: 0, inherited_rate: 0 },
    ],
  },
  day: { blocks: [], rate: 0.5 },
  week: { blocks: [], rate: 0.5 },
}

test('realtime gaps retain both success and failure colors and identify inherited results without fabricated counts', () => {
  render(<SuccessStripes stats={stats} />)
  expect(
    screen.getByTitle('Previous result retained until the next test: 100%')
  ).toHaveClass('bg-success')
  expect(
    screen.getByTitle('Previous result retained until the next test: 0%')
  ).toHaveClass('bg-destructive')
  expect(screen.getByTitle('Success 0 / Failed 0')).toHaveClass(
    'bg-muted-foreground/20'
  )
  expect(screen.getByTitle('Success 1 / Failed 0')).toHaveClass('bg-success')
  expect(screen.getByTitle('Success 0 / Failed 1')).toHaveClass(
    'bg-destructive'
  )
  expect(screen.getByRole('img')).toHaveAccessibleName(
    'Success rate: realtime 50%, 24h 50%, 7d 50%'
  )
})

test('an inherited failed result takes precedence over the administrator default-success setting', () => {
  render(<SuccessStripes stats={stats} defaultEmptySuccess />)
  expect(screen.getByTitle('Success 0 / Failed 0')).toHaveClass('bg-success')
  expect(
    screen.getByTitle('Previous result retained until the next test: 0%')
  ).toHaveClass('bg-destructive')
})

test('a realtime window with no new requests displays the retained result while untested models remain unknown', () => {
  const rendered = render(
    <SuccessStripes
      stats={{
        ...stats,
        realtime: {
          rate: null,
          blocks: [{ ok: 0, fail: 0, inherited_rate: 0 }],
        },
      }}
    />
  )
  expect(screen.getByRole('img')).toHaveAccessibleName(
    'Success rate: realtime 0%, 24h 50%, 7d 50%'
  )
  expect(
    screen.getByTitle(
      'No new requests in this window; showing the previous result: 0%'
    )
  ).toHaveTextContent('0%')
  rendered.rerender(<SuccessStripes />)
  expect(screen.getByRole('img')).toHaveAccessibleName('Not enough data')
  expect(screen.getAllByText('-')).toHaveLength(3)
})

test('the Chinese interface explains retained results in Chinese without falling back to English', async () => {
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({
    resources: { en, zhCN },
    lng: 'zhCN',
    fallbackLng: 'en',
    nsSeparator: false,
    interpolation: { escapeValue: false },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <SuccessStripes stats={stats} />
    </I18nextProvider>
  )
  expect(screen.getByTitle('沿用上次结果，直到下一次测试：100%')).toHaveClass(
    'bg-success'
  )
  expect(screen.getByTitle('沿用上次结果，直到下一次测试：0%')).toHaveClass(
    'bg-destructive'
  )
  expect(
    screen.queryByTitle('Previous result retained until the next test: 100%')
  ).not.toBeInTheDocument()
})
