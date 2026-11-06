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
import { useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { NavCollapsible, NavGroup, NavLink } from '../types'
import { ConsoleNavigation } from './console-navigation'

export function ContextNavigation(props: { groups: NavGroup[] }) {
  const { t } = useTranslation()
  const pathname = useLocation({ select: (location) => location.pathname })
  const items = props.groups.flatMap((group) => group.items)
  const categories = items.filter((item): item is NavCollapsible =>
    Boolean(item.items?.length)
  )
  const categoryLinks: NavLink[] = categories.map((category) => ({
    title: category.title,
    icon: category.icon,
    url: category.items[0].url,
    activeUrls: category.items.flatMap((item) => [
      item.url,
      ...(item.activeUrls ?? []),
    ]),
  }))
  const activeCategory = categories.find((category) =>
    category.items.some((item) =>
      [item.url, ...(item.activeUrls ?? [])].some(
        (url) => pathname === url || pathname.startsWith(`${url}/`)
      )
    )
  )
  const sectionLinks = [
    ...items.filter((item): item is NavLink => Boolean(item.url)),
    ...(activeCategory?.items ?? []),
  ]

  return (
    <div className='hwjai-settings-navigation max-w-full min-w-0'>
      {categoryLinks.length > 0 && (
        <div className='hwjai-context-navigation'>
          <ConsoleNavigation
            items={categoryLinks}
            label={t('Settings categories')}
          />
        </div>
      )}
      {sectionLinks.length > 0 && (
        <div className='hwjai-context-navigation'>
          <ConsoleNavigation items={sectionLinks} contextual />
        </div>
      )}
    </div>
  )
}
