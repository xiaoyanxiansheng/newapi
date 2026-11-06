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
import { Link, type LinkProps } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useNotifications } from '@/hooks/use-notifications'
import { useSidebarConfig } from '@/hooks/use-sidebar-config'
import { useSidebarData } from '@/hooks/use-sidebar-data'
import { useSidebarView } from '@/hooks/use-sidebar-view'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import type { NavLink } from '../types'
import { ConsoleNavigation } from './console-navigation'
import { ContextNavigation } from './context-navigation'
import { SystemBrand } from './system-brand'

export function ConsoleHeader() {
  const { t } = useTranslation()
  const data = useSidebarData()
  const groups = useSidebarConfig(data.navGroups)
  const role = useAuthStore((state) => state.auth.user?.role) ?? ROLE.GUEST
  const notifications = useNotifications()
  const contextual = useSidebarView()
  const links = groups
    .filter((group) => group.id !== 'admin' || role >= ROLE.ADMIN)
    .flatMap((group) => group.items)
    .filter(
      (item): item is NavLink =>
        Boolean(item.url) &&
        (item.requiredRole === undefined || role >= item.requiredRole)
    )
  const primary = links.filter((item) =>
    [
      '/dashboard/overview',
      '/market',
      '/keys',
      '/dashboard/models',
      '/profile',
    ].includes(String(item.url))
  )
  const extra = links.filter((item) => !primary.includes(item))
  const showContextual =
    contextual.view !== null &&
    (contextual.view.id !== 'system-settings' || role === ROLE.SUPER_ADMIN)
  return (
    <header className='hwjai-console-header'>
      <div className='hwjai-console-header-inner'>
        <div className='min-w-0'>
          <SystemBrand variant='inline' />
        </div>
        <div className='hwjai-console-navigation-slot'>
          <ConsoleNavigation items={primary} />
        </div>
        <div className='flex items-center justify-end gap-0.5 sm:gap-1'>
          {extra.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('More navigation')}
                  />
                }
              >
                <Settings2 className='size-4' />
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {extra.map((item) => (
                  <DropdownMenuItem
                    key={item.url}
                    render={<Link to={item.url as LinkProps['to']} />}
                  >
                    {item.title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <NotificationPopover
            open={notifications.popoverOpen}
            onOpenChange={notifications.setPopoverOpen}
            unreadCount={notifications.unreadCount}
            activeTab={notifications.activeTab}
            onTabChange={notifications.setActiveTab}
            notice={notifications.notice}
            announcements={notifications.announcements}
            loading={notifications.loading}
          />
          <LanguageSwitcher />
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </div>
      {showContextual && <ContextNavigation groups={contextual.navGroups} />}
    </header>
  )
}
