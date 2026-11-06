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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import type { MarketProbeUsage } from '../types'

export function TokenConsumption(props: { usage?: MarketProbeUsage | null }) {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const usage = props.usage
  const hasUsage =
    !!usage &&
    usage.samples > 0 &&
    usage.total_tokens >= 0 &&
    usage.estimated_samples === 0 &&
    Number.isFinite(usage.average_tokens)
  let label = t('Very low')
  let color = 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (hasUsage && usage.average_tokens >= 10000) {
    label = t('Very high')
    color = 'bg-red-500/10 text-red-700 dark:text-red-300'
  } else if (hasUsage && usage.average_tokens >= 1000) {
    label = t('High')
    color = 'bg-orange-500/10 text-orange-700 dark:text-orange-300'
  } else if (hasUsage && usage.average_tokens >= 100) {
    label = t('Low')
    color = 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
  }
  if (!hasUsage) color = 'bg-muted text-muted-foreground'
  const format = new Intl.NumberFormat(
    toIntlLocale(i18n.resolvedLanguage || i18n.language),
    {
      maximumFractionDigits: 1,
    }
  )
  const protocols: Record<string, string> = {
    openai: 'Chat',
    'openai-response': 'Responses',
    anthropic: 'Messages',
    gemini: 'Gemini',
  }
  const hasDetails = !!usage && (hasUsage || !!usage.recent?.length)
  return (
    <div
      role='group'
      aria-label={t('Token consumption')}
      className='hwjai-token-consumption min-w-0 space-y-1.5'
    >
      <span className='text-muted-foreground block text-[11px]'>
        {t('Token consumption')}
      </span>
      {hasDetails ? (
        <>
          <button
            type='button'
            aria-haspopup='dialog'
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-primary',
              color
            )}
          >
            {hasUsage ? label : t('Unknown')}
          </button>
          {hasUsage && (
            <span className='text-muted-foreground block text-[10px]'>
              {t('Average {{tokens}} tokens / probe', {
                tokens: format.format(usage.average_tokens),
              })}
            </span>
          )}
          {usage.protocol && (
            <span className='text-muted-foreground block text-[10px]'>
              {protocols[usage.protocol] ?? usage.protocol}
            </span>
          )}
          <Dialog open={expanded} onOpenChange={setExpanded}>
            <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-xl'>
              <DialogHeader>
                <DialogTitle>{t('Token consumption')}</DialogTitle>
                <DialogDescription>
                  {t(
                    'Fixed OK test, with a 256 output token budget. Only upstream-reported usage is counted.'
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className='space-y-3 text-xs break-words'>
                <p>
                  {t(
                    'Last 7 days: {{tokens}} tokens across {{samples}} successful probes.',
                    {
                      tokens: format.format(usage.total_tokens),
                      samples: usage.samples,
                    }
                  )}
                </p>
                {!!usage.unknown_samples && (
                  <p>
                    {t(
                      '{{samples}} successful probes have unknown usage and are excluded from the grade.',
                      {
                        samples: usage.unknown_samples,
                      }
                    )}
                  </p>
                )}
                {(usage.recent ?? []).map((record) => (
                  <div key={record.id} className='rounded-lg border p-3'>
                    <p className='mb-2 font-medium'>
                      {protocols[record.protocol] ?? record.protocol} ·{' '}
                      {new Date(record.at * 1000).toLocaleString(
                        toIntlLocale(i18n.resolvedLanguage || i18n.language)
                      )}
                    </p>
                    {!record.success && (
                      <p className='text-muted-foreground mb-2'>
                        {t(
                          'This request did not complete successfully and is excluded from the grade.'
                        )}
                      </p>
                    )}
                    {record.output_limited && (
                      <p className='mb-2 text-amber-700 dark:text-amber-300'>
                        {t('Output reached the test budget.')}
                      </p>
                    )}
                    <dl className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                      {[
                        [t('Input tokens'), record.input_tokens],
                        [t('Output tokens'), record.output_tokens],
                        [t('Cache read tokens'), record.cache_read_tokens],
                        [t('Cache write tokens'), record.cache_write_tokens],
                        [t('Reasoning tokens'), record.reasoning_tokens],
                        [t('Total tokens'), record.total_tokens],
                      ].map(([name, value]) => (
                        <div key={name}>
                          <dt className='text-muted-foreground'>{name}</dt>
                          <dd className='font-mono font-semibold'>
                            {typeof value === 'number'
                              ? format.format(value)
                              : t('Unknown')}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {record.total_source === 'components' && (
                      <p className='text-muted-foreground mt-2'>
                        {t(
                          'Total is the sum of upstream-reported usage fields, without local estimation.'
                        )}
                      </p>
                    )}
                  </div>
                ))}
                <p>
                  {t(
                    'Very low: <100; low: 100–999; high: 1,000–9,999; very high: ≥10,000 tokens per probe.'
                  )}
                </p>
                <p>
                  {t(
                    'Probe consumption is a reference for this channel and model, not your actual request usage.'
                  )}
                </p>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <span
          className='text-muted-foreground text-xs'
          title={t('No probe usage data yet')}
        >
          —
        </span>
      )}
    </div>
  )
}
