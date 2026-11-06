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
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampRelative } from '@/lib/format'

import type { MarketStats } from '../types'

export function LastSuccess({ stats }: { stats?: MarketStats | null }) {
  const { t, i18n } = useTranslation()
  let text = t('Not enough data')
  if (stats?.last_success_at) {
    text = t('Last success {{time}}', {
      time: formatTimestampRelative(
        stats.last_success_at,
        'seconds',
        toIntlLocale(i18n.resolvedLanguage || i18n.language)
      ),
    })
  } else if (stats) {
    text = t('No successful requests yet')
  }
  return <span className='text-muted-foreground text-[11px]'>{text}</span>
}
