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
import { Plus, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import type { ChannelOption } from '../types'

type ListingToolbarProps = {
  channels: ChannelOption[]
  channelId: number | null
  keyword: string
  onChannelChange: (channelId: number | null) => void
  onKeywordChange: (keyword: string) => void
  onGenerate: () => void
  onAdd: () => void
}

export function ListingToolbar(props: ListingToolbarProps) {
  const { t } = useTranslation()

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <NativeSelect
        aria-label={t('Channel')}
        value={props.channelId === null ? '' : String(props.channelId)}
        onChange={(event) => {
          const value = event.target.value
          props.onChannelChange(value === '' ? null : Number(value))
        }}
      >
        <NativeSelectOption value=''>{t('All channels')}</NativeSelectOption>
        {props.channels.map((channel) => (
          <NativeSelectOption key={channel.id} value={String(channel.id)}>
            #{channel.id} {channel.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Input
        className='h-8 w-56'
        placeholder={t('Search model name...')}
        aria-label={t('Search model name...')}
        value={props.keyword}
        onChange={(event) => props.onKeywordChange(event.target.value)}
      />
      <div className='ml-auto flex items-center gap-2'>
        <Button variant='outline' size='sm' onClick={props.onGenerate}>
          <Wand2 aria-hidden='true' />
          {t('Generate from channel')}
        </Button>
        <Button size='sm' onClick={props.onAdd}>
          <Plus aria-hidden='true' />
          {t('Add listing')}
        </Button>
      </div>
    </div>
  )
}
