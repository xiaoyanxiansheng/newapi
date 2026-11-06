import { useTranslation } from 'react-i18next'

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
import { DynamicPricingBreakdown } from '@/features/pricing/components/dynamic-pricing-breakdown'

import type { Prices, Quote } from '../types'
import { PriceBreakdown } from './price-breakdown'

export function QuotePrices(props: { quote: Quote; original?: boolean }) {
  const { t } = useTranslation()
  const quote = props.quote
  if (quote.pricing_mode === 'model_routes' && props.original) {
    return (
      <div className='min-w-0 space-y-2'>
        <PriceBreakdown
          prices={quote.original}
          unit={quote.unit}
          currency='CNY'
        />
        {!!quote.long_context_threshold && (
          <p className='text-primary text-xs leading-relaxed'>
            {t(
              'Uncached input ≥ {{threshold}} tokens: input ×{{input}}, output ×{{output}}. Cache uses its separate quoted rate.',
              {
                threshold: String(quote.long_context_threshold),
                input: quote.long_context_input_multiplier,
                output: quote.long_context_output_multiplier,
              }
            )}
          </p>
        )}
      </div>
    )
  }
  if (quote.billing_mode === 'tiered_expr') {
    return (
      <DynamicPricingBreakdown
        billingExpr={props.original ? quote.billing_expr : quote.cost_expr}
        compact
        stacked
        displayCurrency={quote.display_currency}
      />
    )
  }
  return (
    <PriceBreakdown
      prices={props.original ? quote.original : quote.cost}
      unit={quote.unit}
      currency={quote.display_currency}
    />
  )
}
export function ProposalPrices(props: {
  prices: Prices
  unit: string
  currency?: string
  expression?: string
  label: string
}) {
  if (props.expression) {
    return (
      <section aria-label={props.label}>
        <DynamicPricingBreakdown
          billingExpr={props.expression}
          compact
          displayCurrency={props.currency}
        />
      </section>
    )
  }
  return (
    <PriceBreakdown
      prices={props.prices}
      unit={props.unit}
      currency={props.currency}
    />
  )
}
