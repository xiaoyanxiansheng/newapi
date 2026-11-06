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
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import * as api from '../api'
import { translateUpstreamError } from '../errors'
import type { ManualPrice, Prices } from '../types'
import { PriceBreakdown } from './price-breakdown'

const labels: Record<keyof Prices, string> = {
  input: 'Input',
  output: 'Output',
  cache_read: 'Cache read',
  cache_write: 'Cache write',
  image_input: 'Image input',
  audio_input: 'Audio input',
  audio_output: 'Audio output',
  request: 'Per request',
}
const schema = z.object({
  cost: z.record(
    z.string(),
    z.string().regex(/^[0-9]+(?:[.][0-9]+)?(?:[eE][+-]?[0-9]{1,2})?$/)
  ),
})

function PriceForm(props: {
  price: ManualPrice
  busy: boolean
  onSave: (cost: Prices) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const fields = (Object.keys(labels) as (keyof Prices)[]).filter(
    (key) => props.price.original[key] !== undefined
  )
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      cost: Object.fromEntries(
        fields.map((key) => [key, props.price.cost[key] ?? ''])
      ),
    },
  })
  return (
    <form
      className='space-y-5'
      onSubmit={form.handleSubmit((input) => {
        const cost: Prices = {}
        for (const key of fields) cost[key] = input.cost[key]
        props.onSave(cost)
      })}
    >
      <p className='font-semibold break-all'>{props.price.model}</p>
      <div className='bg-primary/5 space-y-2 rounded-xl p-4'>
        <p className='text-sm'>
          {t('Original prices from existing model pricing')}
        </p>
        <PriceBreakdown
          prices={props.price.original}
          unit={props.price.unit}
          currency='USD'
        />
      </div>
      <p className='text-muted-foreground text-sm'>
        {t(
          props.price.unit === 'per_request'
            ? 'Enter verified upstream purchase prices in USD per request.'
            : 'Enter verified upstream purchase prices in USD per million tokens.'
        )}
      </p>
      <div className='grid gap-4 sm:grid-cols-2'>
        {fields.map((key) => (
          <div className='space-y-2' key={key}>
            <Label htmlFor={`purchase-${key}`}>
              {t('Purchase price: {{dimension}}', {
                dimension: t(labels[key]),
              })}
            </Label>
            <Input
              id={`purchase-${key}`}
              {...form.register(`cost.${key}`)}
              disabled={props.busy}
              inputMode='decimal'
              aria-invalid={!!form.formState.errors.cost?.[key]}
            />
            {form.formState.errors.cost?.[key] && (
              <p className='text-destructive text-xs'>
                {t('Enter a valid value')}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Saving reference prices does not publish models or change selling prices. Refreshing the model list requires prices to be confirmed again.'
        )}
      </p>
      <div className='flex justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          onClick={props.onCancel}
          disabled={props.busy}
        >
          {t('Cancel')}
        </Button>
        <Button type='submit' disabled={props.busy}>
          {t('Save reference prices')}
        </Button>
      </div>
    </form>
  )
}

export function ManualPriceEditor(props: {
  sourceId: number
  revision: number
  model: string
  busy: boolean
  onSave: (cost: Prices) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const detail = useQuery({
    queryKey: [
      'upstream-manual-price',
      props.sourceId,
      props.revision,
      props.model,
    ],
    queryFn: () => api.getManualPrice(props.sourceId, props.model),
    retry: false,
  })
  if (detail.isPending) return <p role='status'>{t('Loading...')}</p>
  if (detail.isError) {
    return (
      <div role='alert'>
        <p>{translateUpstreamError(detail.error.message, t)}</p>
        <Button onClick={() => detail.refetch()}>{t('Retry')}</Button>
      </div>
    )
  }
  return (
    <PriceForm
      price={detail.data}
      busy={props.busy}
      onSave={props.onSave}
      onCancel={props.onCancel}
    />
  )
}
