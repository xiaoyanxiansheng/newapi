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
import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import {
  CardStaggerContainer,
  CardStaggerItem,
} from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { useIsSidebarModuleVisible } from '@/hooks/use-sidebar-config'
import { useStatus } from '@/hooks/use-status'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  AccountSwitcher,
  type AccountSection,
} from './components/account-switcher'
import { CheckinCalendarCard } from './components/checkin-calendar-card'
import { LanguagePreferencesCard } from './components/language-preferences-card'
import { LoginSessionsCard } from './components/login-sessions-card'
import { PasskeyCard } from './components/passkey-card'
import { ProfileHeader } from './components/profile-header'
import { ProfileSecurityCard } from './components/profile-security-card'
import { ProfileSettingsCard } from './components/profile-settings-card'
import { SidebarModulesCard } from './components/sidebar-modules-card'
import { TwoFACard } from './components/two-fa-card'
import { useProfile } from './hooks'

export function Profile(props: {
  section?: Exclude<AccountSection, 'wallet'>
}) {
  const { t } = useTranslation()
  const { profile, loading, refreshProfile } = useProfile()
  const { status } = useStatus()
  const permissions = useAuthStore((s) => s.auth.user?.permissions)
  const role = useAuthStore((s) => s.auth.user?.role) ?? ROLE.GUEST
  const showWallet = useIsSidebarModuleVisible('/wallet')
  const showPreferences = role >= ROLE.ADMIN
  const requestedSection = props.section ?? 'overview'
  const section =
    requestedSection === 'preferences' && !showPreferences
      ? 'overview'
      : requestedSection
  const checkinEnabled = status?.checkin_enabled === true
  const turnstileEnabled = Boolean(
    status?.turnstile_check && status?.turnstile_site_key
  )
  const canConfigureSidebar = permissions?.sidebar_settings !== false
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Account center')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <CardStaggerContainer className='mx-auto flex w-full max-w-7xl flex-col gap-5'>
          <CardStaggerItem>
            <AccountSwitcher active={section} />
          </CardStaggerItem>
          {section === 'overview' && (
            <>
              <CardStaggerItem>
                <ProfileHeader profile={profile} loading={loading} />
              </CardStaggerItem>
              <CardStaggerItem className='grid gap-4 md:grid-cols-2'>
                {showWallet && (
                  <div className='hwjai-project-card rounded-2xl p-5'>
                    <h3 className='font-semibold'>
                      {t('Balance and billing')}
                    </h3>
                    <p className='text-muted-foreground mt-2 text-sm'>
                      {t(
                        'Manage your balance, recharge and billing in one place.'
                      )}
                    </p>
                    <Button
                      className='mt-4'
                      size='sm'
                      render={
                        <Link to='/profile' search={{ section: 'wallet' }} />
                      }
                    >
                      {t('Add funds')}
                      <ArrowUpRight data-icon='inline-end' />
                    </Button>
                  </div>
                )}
                <div className='hwjai-project-card rounded-2xl p-5'>
                  <h3 className='font-semibold'>{t('Profile and security')}</h3>
                  <p className='text-muted-foreground mt-2 text-sm'>
                    {t('Keep your profile, login methods and sessions secure.')}
                  </p>
                  <Button
                    className='mt-4'
                    size='sm'
                    variant='outline'
                    render={
                      <Link to='/profile' search={{ section: 'profile' }} />
                    }
                  >
                    {t('Manage security')}
                    <ArrowUpRight data-icon='inline-end' />
                  </Button>
                </div>
              </CardStaggerItem>
              {checkinEnabled && (
                <CardStaggerItem>
                  <CheckinCalendarCard
                    checkinEnabled
                    turnstileEnabled={turnstileEnabled}
                    turnstileSiteKey={status?.turnstile_site_key || ''}
                  />
                </CardStaggerItem>
              )}
            </>
          )}
          {section === 'profile' && (
            <CardStaggerItem className='grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.5fr)]'>
              <div className='space-y-5'>
                <ProfileSettingsCard
                  profile={profile}
                  loading={loading}
                  onProfileUpdate={refreshProfile}
                />
                <ProfileSecurityCard profile={profile} loading={loading} />
                <LoginSessionsCard />
              </div>
              <div className='space-y-5'>
                <PasskeyCard loading={loading} />
                <TwoFACard loading={loading} />
              </div>
            </CardStaggerItem>
          )}
          {section === 'preferences' && (
            <CardStaggerItem className='space-y-5'>
              <LanguagePreferencesCard
                profile={profile}
                onProfileUpdate={refreshProfile}
              />
              {canConfigureSidebar && <SidebarModulesCard />}
            </CardStaggerItem>
          )}
        </CardStaggerContainer>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
