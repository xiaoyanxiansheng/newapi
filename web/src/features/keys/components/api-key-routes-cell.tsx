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
import { Button } from '@/components/ui/button'

import type { ApiKey } from '../types'
import { useApiKeys } from './api-keys-provider'

export function ApiKeyRoutesCell(props: { apiKey: ApiKey }) {
  const { t } = useTranslation()
  const { setOpen, setCurrentRow } = useApiKeys()
  const routes = props.apiKey.routes ?? []
  const channelCount = routes.reduce((sum, r) => sum + r.channels.length, 0)

  return (
    <div className='flex items-center gap-2'>
      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={() => {
          setCurrentRow(props.apiKey)
          setOpen('routes')
        }}
      >
        {t('{{models}} models · {{channels}} channels', {
          models: routes.length,
          channels: channelCount,
        })}
      </Button>
      {routes.length === 0 ? (
        <Badge variant='destructive'>{t('No routes')}</Badge>
      ) : (
        <Badge variant='outline'>
          {props.apiKey.auto_route ? t('Auto route on') : t('Auto route off')}
        </Badge>
      )}
    </div>
  )
}
