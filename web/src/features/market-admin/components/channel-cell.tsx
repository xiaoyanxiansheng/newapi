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

import { Badge } from '@/components/ui/badge'

type ChannelCellProps = {
  channelId: number
  channelName: string
  channelStatus: number
}

export function ChannelCell(props: ChannelCellProps) {
  const { t } = useTranslation()

  let statusBadge = (
    <Badge variant='outline' className='text-success'>
      {t('Enabled')}
    </Badge>
  )
  if (props.channelStatus === 2) {
    statusBadge = <Badge variant='secondary'>{t('Manually disabled')}</Badge>
  } else if (props.channelStatus === 3) {
    statusBadge = <Badge variant='destructive'>{t('Auto disabled')}</Badge>
  } else if (props.channelStatus !== 1) {
    statusBadge = <Badge variant='secondary'>{t('Unknown')}</Badge>
  }

  return (
    <div className='flex flex-col gap-0.5'>
      <div className='flex items-center gap-1.5'>
        <span className='font-medium'>#{props.channelId}</span>
        {statusBadge}
      </div>
      <span className='text-muted-foreground max-w-40 truncate text-xs'>
        {props.channelName}
      </span>
    </div>
  )
}
