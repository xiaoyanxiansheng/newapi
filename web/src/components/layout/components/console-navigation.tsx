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
import { Link, useLocation, type LinkProps } from '@tanstack/react-router'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { NavLink } from '../types'

export function ConsoleNavigation(props: {
  items: NavLink[]
  contextual?: boolean
  label?: string
}) {
  const { t } = useTranslation()
  const pathname = useLocation({ select: (location) => location.pathname })
  const reducedMotion = useReducedMotion()
  return (
    <LayoutGroup id={props.label ?? (props.contextual ? 'sections' : 'main')}>
      <nav
        aria-label={
          props.label ??
          (props.contextual ? t('Section navigation') : t('Main navigation'))
        }
        className='hwjai-top-navigation'
      >
        {props.items.map((item) => {
          const paths = [item.url, ...(item.activeUrls ?? [])]
          const active = paths.some(
            (path) => pathname === path || pathname.startsWith(`${path}/`)
          )
          const Icon = item.icon
          return (
            <Link
              key={item.url}
              to={item.url as LinkProps['to']}
              aria-current={active ? 'page' : undefined}
              className={cn('hwjai-top-link', active && 'is-active')}
            >
              {active && (
                <motion.span
                  layoutId='console-navigation-active'
                  className='hwjai-top-selection'
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 420, damping: 35 }
                  }
                  aria-hidden='true'
                />
              )}
              {Icon && (
                <Icon className='relative size-4 shrink-0' aria-hidden='true' />
              )}
              <span className='relative whitespace-nowrap'>{item.title}</span>
            </Link>
          )
        })}
      </nav>
    </LayoutGroup>
  )
}
