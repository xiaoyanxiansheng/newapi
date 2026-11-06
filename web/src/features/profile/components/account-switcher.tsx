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
import {
  CreditCard,
  UserRound,
  SlidersHorizontal,
  LayoutGrid,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useIsSidebarModuleVisible } from '@/hooks/use-sidebar-config'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

export type AccountSection = 'overview' | 'profile' | 'wallet' | 'preferences'

export function AccountSwitcher(props: { active: AccountSection }) {
  const { t } = useTranslation()
  const showProfile = useIsSidebarModuleVisible('/profile')
  const showWallet = useIsSidebarModuleVisible('/wallet')
  const role = useAuthStore((state) => state.auth.user?.role) ?? ROLE.GUEST
  const items = [
    {
      key: 'overview' as const,
      icon: LayoutGrid,
      label: t('Account overview'),
      visible: showProfile,
    },
    {
      key: 'profile' as const,
      icon: UserRound,
      label: t('Profile and security'),
      visible: showProfile,
    },
    {
      key: 'wallet' as const,
      icon: CreditCard,
      label: t('Balance and billing'),
      visible: showWallet,
    },
    {
      key: 'preferences' as const,
      icon: SlidersHorizontal,
      label: t('Preferences'),
      visible: showProfile && role >= ROLE.ADMIN,
    },
  ]
  return (
    <nav aria-label={t('Account center')} className='hwjai-view-switcher'>
      {items
        .filter((item) => item.visible)
        .map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.key}
              to='/profile'
              search={{ section: item.key }}
              aria-current={props.active === item.key ? 'page' : undefined}
              className={cn(
                'hwjai-view-tab',
                props.active === item.key && 'is-active'
              )}
            >
              <Icon className='size-4' aria-hidden='true' />
              {item.label}
            </Link>
          )
        })}
    </nav>
  )
}
