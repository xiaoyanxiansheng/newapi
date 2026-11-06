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
import { AnimatedOutlet } from '@/components/page-transition'
import { SkipToMain } from '@/components/skip-to-main'
import { SidebarProvider } from '@/components/ui/sidebar'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'

import { ConsoleHeader } from './console-header'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

export function AuthenticatedLayout(props: AuthenticatedLayoutProps) {
  return (
    <LayoutProvider>
      <SearchProvider>
        <SidebarProvider defaultOpen={false} className='h-svh min-h-0 flex-col'>
          <SkipToMain />
          <ConsoleHeader />
          <div className='@container/content flex min-h-0 w-full flex-1 flex-col overflow-hidden'>
            {props.children ?? <AnimatedOutlet />}
          </div>
        </SidebarProvider>
      </SearchProvider>
    </LayoutProvider>
  )
}
