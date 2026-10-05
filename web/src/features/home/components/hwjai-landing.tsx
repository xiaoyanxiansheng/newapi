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
import { ArrowUpRight, BookOpen, Check, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'

import { HomeAuthPanel } from './home-auth-panel'
import { HwjaiMark } from './hwjai-mark'

import '@/styles/hwjai-home.css'

export function HwjaiLanding() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const configuredDocsUrl =
    typeof status?.docs_link === 'string' ? status.docs_link : ''
  const docsUrl = configuredDocsUrl || 'https://docs.newapi.pro'

  return (
    <main id='main-content' className='hwjai-landing'>
      <section
        className='hwjai-split'
        aria-label={t('AI access and account sign-in')}
      >
        <div className='hwjai-story'>
          <div className='hwjai-story-content'>
            <div className='hwjai-eyebrow'>
              <span aria-hidden='true' />
              {t('AI model API access')}
            </div>
            <h1 className='hwjai-headline'>
              {t('Simpler AI access.')}
              <span>{t('Clearer token costs.')}</span>
            </h1>
            <p className='hwjai-story-description'>
              {t(
                'Connect AI models to your apps, developer tools and workflows. Manage API keys, balance and usage in one workspace.'
              )}
            </p>
            <ul className='hwjai-benefits'>
              <li>
                <Check aria-hidden='true' />
                <div>
                  <strong>{t('One interface, more possibilities')}</strong>
                  <span>
                    {t(
                      'Spend less time switching integrations and more time building.'
                    )}
                  </span>
                </div>
              </li>
              <li>
                <Check aria-hidden='true' />
                <div>
                  <strong>{t('The right model for the task')}</strong>
                  <span>
                    {t(
                      'Explore the model marketplace and choose what fits your workflow.'
                    )}
                  </span>
                </div>
              </li>
              <li>
                <Check aria-hidden='true' />
                <div>
                  <strong>{t('Your usage, in one place')}</strong>
                  <span>
                    {t(
                      'Keep track of your keys, account balance and request history.'
                    )}
                  </span>
                </div>
              </li>
            </ul>
            <div className='hwjai-access-art' aria-hidden='true'>
              <div className='hwjai-access-orbit' />
              <div className='hwjai-access-card'>
                <div className='hwjai-access-card-top'>
                  <HwjaiMark className='size-9' />
                  <span>hwjai</span>
                  <KeyRound size={18} />
                </div>
                <div className='hwjai-access-card-label'>API ACCESS</div>
                <div className='hwjai-access-card-bottom'>
                  <span>ONE KEY. MORE POSSIBILITIES.</span>
                  <span className='hwjai-token-dots'>•••• •••• ••••</span>
                </div>
              </div>
              <span className='hwjai-art-word'>TOKEN</span>
            </div>
            <a
              href={docsUrl}
              className='hwjai-docs-link'
              target={/^https?:\/\//i.test(docsUrl) ? '_blank' : undefined}
              rel='noopener noreferrer'
            >
              <BookOpen aria-hidden='true' size={16} />
              {t('Read the integration guide')}
              <ArrowUpRight aria-hidden='true' size={15} />
            </a>
          </div>
        </div>
        <div className='hwjai-account'>
          <HomeAuthPanel />
          <p className='hwjai-account-note'>
            {t('Built for the way you work with AI.')}
          </p>
        </div>
      </section>
      <section className='hwjai-start' aria-labelledby='hwjai-start-title'>
        <div className='hwjai-start-heading'>
          <p className='text-muted-foreground text-xs font-medium tracking-widest uppercase'>
            {t('From idea to API')}
          </p>
          <h2 id='hwjai-start-title'>
            {t('A shorter path to your first request.')}
          </h2>
          <Link to='/market' className='hwjai-market-link'>
            {t('Explore models')}
            <ArrowUpRight aria-hidden='true' size={16} />
          </Link>
        </div>
        <ol className='hwjai-steps'>
          <li>
            <span aria-hidden='true'>01</span>
            <h3>{t('Create your account')}</h3>
            <p>{t('Sign up here and open your workspace.')}</p>
          </li>
          <li>
            <span aria-hidden='true'>02</span>
            <h3>{t('Choose a model and key')}</h3>
            <p>
              {t(
                'Review model pricing, then create an API key in the console.'
              )}
            </p>
          </li>
          <li>
            <span aria-hidden='true'>03</span>
            <h3>{t('Connect your application')}</h3>
            <p>
              {t(
                'Use your key and the integration guide to send your first request.'
              )}
            </p>
          </li>
        </ol>
      </section>
    </main>
  )
}
