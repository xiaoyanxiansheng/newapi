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
import {
  Activity,
  Box,
  CreditCard,
  Key,
  LayoutDashboard,
  ListTodo,
  ServerCog,
  Settings,
  Ticket,
  User,
  Users,
  Store,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SidebarData } from '@/components/layout/types'
import { useStatus } from '@/hooks/use-status'
import { ROLE } from '@/lib/roles'
import { getPluginSidebarItems } from '@/plugins/manifest'

/**
 * Root navigation groups for the application sidebar.
 *
 * These are shown when the URL does not match any nested sidebar view
 * registered in `layout/lib/sidebar-view-registry.ts`.
 */
export function useSidebarData(): SidebarData {
  const { t } = useTranslation()
  const { status } = useStatus()

  const pluginItems = getPluginSidebarItems(t)

  return {
    navGroups: [
      {
        id: 'general',
        title: t('General'),
        items: [
          {
            title: t('Workspace'),
            url: '/dashboard/overview',
            icon: Activity,
          },
          {
            title: t('Models'),
            url: '/market',
            icon: Store,
          },
          {
            title: t('API Access'),
            url: '/keys',
            icon: Key,
          },
          {
            title: t('Usage'),
            url: '/dashboard/models',
            activeUrls: ['/usage-logs/common'],
            configUrls: ['/dashboard/models', '/usage-logs/common'],
            icon: LayoutDashboard,
          },
          ...(status?.enable_task === false
            ? []
            : [
                {
                  title: t('Task Logs'),
                  url: '/usage-logs/task',
                  activeUrls: ['/usage-logs/drawing'],
                  configUrls: ['/usage-logs/drawing', '/usage-logs/task'],
                  icon: ListTodo,
                  requiredRole: ROLE.ADMIN,
                },
              ]),
          ...pluginItems,
        ],
      },
      {
        id: 'personal',
        title: t('Personal'),
        items: [
          {
            title: t('Account'),
            url: '/profile',
            activeUrls: ['/wallet'],
            configUrls: ['/profile', '/wallet'],
            icon: User,
          },
        ],
      },
      {
        id: 'admin',
        title: t('Admin'),
        items: [
          {
            title: t('Models'),
            url: '/models/metadata',
            icon: Box,
          },
          {
            title: t('Upstream channels'),
            url: '/upstream-catalog',
            icon: ServerCog,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Users'),
            url: '/users',
            icon: Users,
          },
          {
            title: t('Redemption Codes'),
            url: '/redemption-codes',
            icon: Ticket,
          },
          {
            title: t('Subscriptions'),
            url: '/subscriptions',
            icon: CreditCard,
          },
          {
            title: t('System Info'),
            url: '/system-info',
            icon: ServerCog,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('System Settings'),
            url: '/system-settings/site',
            activeUrls: ['/system-settings'],
            icon: Settings,
          },
        ],
      },
    ],
  }
}
