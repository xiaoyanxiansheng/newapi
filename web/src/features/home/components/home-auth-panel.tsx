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
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TermsFooter } from '@/features/auth/components/terms-footer'
import { getRegistrationCapabilities } from '@/features/auth/lib/registration-capabilities'
import { UserAuthForm } from '@/features/auth/sign-in/components/user-auth-form'
import { SignUpForm } from '@/features/auth/sign-up/components/sign-up-form'
import { useStatus } from '@/hooks/use-status'
import { useAuthStore } from '@/stores/auth-store'

export function HomeAuthPanel() {
  const { t } = useTranslation()
  const { status, loading, error } = useStatus()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.auth.user)
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const loginTabRef = useRef<HTMLButtonElement>(null)
  const focusLoginRef = useRef(false)
  const { canRegister } = getRegistrationCapabilities(status)
  const activeMode = canRegister ? mode : 'sign-in'

  useEffect(() => {
    if (!canRegister && mode === 'sign-up') {
      setMode('sign-in')
      loginTabRef.current?.focus()
    }
    if (focusLoginRef.current && activeMode === 'sign-in') {
      focusLoginRef.current = false
      loginTabRef.current?.focus()
    }
  }, [canRegister, mode, activeMode])

  if (user) {
    return (
      <div className='hwjai-auth-panel'>
        <div className='hwjai-auth-kicker'>
          <ShieldCheck aria-hidden='true' size={16} />
          {t('Your workspace is ready')}
        </div>
        <h2 className='hwjai-auth-title'>
          {t('Welcome back, {{name}}', {
            name: user.display_name || user.username,
          })}
        </h2>
        <p className='hwjai-auth-description'>
          {t(
            'Pick up where you left off. Your models, keys and usage are in one place.'
          )}
        </p>
        <div className='mt-8 grid gap-3'>
          <Button
            className='hwjai-primary-button'
            render={<Link to='/dashboard' />}
          >
            {t('Go to Dashboard')}
            <ArrowUpRight aria-hidden='true' />
          </Button>
          <Button
            variant='outline'
            className='h-12 rounded-xl'
            render={<Link to='/keys' />}
          >
            <KeyRound aria-hidden='true' />
            {t('Manage API keys')}
          </Button>
          <Button
            variant='ghost'
            className='h-12 rounded-xl'
            render={<Link to='/market' />}
          >
            {t('Explore models')}
            <ArrowUpRight aria-hidden='true' />
          </Button>
        </div>
      </div>
    )
  }

  if (loading || (!status && !error)) {
    return (
      <div className='hwjai-auth-panel' role='status'>
        <Loader2 aria-hidden='true' className='mb-4 size-6 animate-spin' />
        <p>{t('Loading sign-in options...')}</p>
      </div>
    )
  }

  if (error || !status) {
    return (
      <div className='hwjai-auth-panel' role='alert'>
        <h2 className='hwjai-auth-title'>
          {t('Sign-in options are unavailable')}
        </h2>
        <p className='hwjai-auth-description'>
          {t('We could not load the account settings. Please try again.')}
        </p>
        <Button
          type='button'
          variant='outline'
          className='mt-6'
          onClick={() =>
            void queryClient.invalidateQueries({ queryKey: ['status'] })
          }
        >
          {t('Try again')}
        </Button>
      </div>
    )
  }

  return (
    <div className='hwjai-auth-panel'>
      <div className='hwjai-auth-kicker'>
        <ShieldCheck aria-hidden='true' size={16} />
        {t('Your next idea starts here')}
      </div>
      <h2 className='hwjai-auth-title'>
        {activeMode === 'sign-in'
          ? t('Sign in to hwjai')
          : t('Create your hwjai account')}
      </h2>
      <p className='hwjai-auth-description'>
        {activeMode === 'sign-in'
          ? t('One account for your AI models, API keys and usage.')
          : t('Set up your account, choose a model and start building.')}
      </p>
      <Tabs
        value={activeMode}
        onValueChange={(value) => {
          if (value === 'sign-in' || (value === 'sign-up' && canRegister)) {
            setMode(value)
          }
        }}
        className='mt-7 gap-6'
      >
        <TabsList
          activateOnFocus
          aria-label={t('Account access')}
          className='h-11 w-full rounded-xl p-1'
        >
          <TabsTrigger ref={loginTabRef} value='sign-in' className='rounded-lg'>
            {t('Sign in')}
          </TabsTrigger>
          {canRegister && (
            <TabsTrigger value='sign-up' className='rounded-lg'>
              {t('Create account')}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value='sign-in'>
          {activeMode === 'sign-in' && <UserAuthForm redirectTo='/dashboard' />}
        </TabsContent>
        {canRegister && (
          <TabsContent value='sign-up'>
            {activeMode === 'sign-up' && (
              <SignUpForm
                onRegistered={() => {
                  focusLoginRef.current = true
                  setMode('sign-in')
                }}
              />
            )}
          </TabsContent>
        )}
      </Tabs>
      {!canRegister && (
        <p className='text-muted-foreground mt-5 text-sm'>
          {t('New account registration is currently unavailable.')}
        </p>
      )}
      <TermsFooter
        variant={activeMode}
        status={status}
        className='mt-6 text-center'
      />
    </div>
  )
}
