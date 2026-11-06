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
import { Link } from '@tanstack/react-router'
import { Activity, ChartNoAxesCombined, ListFilter } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useIsSidebarModuleVisible } from '@/hooks/use-sidebar-config'
import { cn } from '@/lib/utils'

export function UsageSwitcher(props: {
  active: 'summary' | 'trends' | 'requests'
}) {
  const { t } = useTranslation()
  const showAnalytics = useIsSidebarModuleVisible('/dashboard/models')
  const showRequests = useIsSidebarModuleVisible('/usage-logs/common')
  return (
    <nav aria-label={t('Usage views')} className='hwjai-view-switcher'>
      {showAnalytics && (
        <>
          <Link
            to='/dashboard/$section'
            params={{ section: 'models' }}
            search={{ view: 'summary' }}
            aria-current={props.active === 'summary' ? 'page' : undefined}
            className={cn(
              'hwjai-view-tab',
              props.active === 'summary' && 'is-active'
            )}
          >
            <Activity className='size-4' aria-hidden='true' />
            {t('Usage overview')}
          </Link>
          <Link
            to='/dashboard/$section'
            params={{ section: 'models' }}
            search={{ view: 'trends' }}
            aria-current={props.active === 'trends' ? 'page' : undefined}
            className={cn(
              'hwjai-view-tab',
              props.active === 'trends' && 'is-active'
            )}
          >
            <ChartNoAxesCombined className='size-4' aria-hidden='true' />
            {t('Trends')}
          </Link>
        </>
      )}
      {showRequests && (
        <Link
          to='/usage-logs/$section'
          params={{ section: 'common' }}
          aria-current={props.active === 'requests' ? 'page' : undefined}
          className={cn(
            'hwjai-view-tab',
            props.active === 'requests' && 'is-active'
          )}
        >
          <ListFilter className='size-4' aria-hidden='true' />
          {t('Request history')}
        </Link>
      )}
    </nav>
  )
}
