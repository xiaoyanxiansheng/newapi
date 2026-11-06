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
import { t } from 'i18next'

import {
  discoverUpstreamPage,
  type BrowserDiscovery,
} from './browser-discovery'

export type BrowserAuthorization = {
  access_token: string
  user_id: number
  discovery?: BrowserDiscovery
}

export function readAuthorizationMessage(
  event: MessageEvent,
  origin: string,
  nonce: string,
  opened: Window | null
): BrowserAuthorization | null {
  if (!opened || event.source !== opened || event.origin !== origin) return null
  const value: unknown = event.data
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (
    data.type === 'hwjai-upstream-authorization' &&
    data.nonce === nonce &&
    data.discovery &&
    typeof data.discovery === 'object'
  ) {
    const discovery = data.discovery as BrowserDiscovery
    try {
      if (
        new URL(discovery.page_url).origin !== origin ||
        !Array.isArray(discovery.keys) ||
        discovery.keys.length > 10000 ||
        !['newapi', 'api', 'page'].includes(discovery.connector?.kind) ||
        JSON.stringify(discovery).length > 8 * 1024 * 1024
      ) {
        return null
      }
      return {
        access_token: '',
        user_id: discovery.identity?.id || 0,
        discovery,
      }
    } catch {
      return null
    }
  }
  if (
    data.type !== 'hwjai-upstream-authorization' ||
    data.nonce !== nonce ||
    typeof data.access_token !== 'string' ||
    data.access_token.length === 0 ||
    data.access_token.length > 16384 ||
    typeof data.user_id !== 'number' ||
    !Number.isSafeInteger(data.user_id) ||
    data.user_id <= 0
  ) {
    return null
  }
  return { access_token: data.access_token, user_id: data.user_id }
}

// This runs only when the administrator clicks their bookmark on the chosen
// upstream origin. Secrets travel by scoped postMessage, never in URLs/storage.
export function authorizationBookmark(
  _upstreamOrigin: string,
  destination: string,
  _nonce?: string
): string {
  const config = JSON.stringify({
    destination,
    labels: {
      intro: t(
        'hwjai could not find a complete Key automatically. Select its area below. Reveal hidden Keys on the website first.'
      ),
      pick: t('Select the Key area'),
      cancel: t('Cancel'),
      choose: t(
        'Click the existing Key text or input. This click only selects the area and does not activate the original page action.'
      ),
      retry: t(
        'The selected area has no complete Key. Reveal the Key first or select its actual text or input again.'
      ),
      noKeys: t(
        'No readable existing Keys were found. Reveal a Key on this page, then click the authorization bookmark again.'
      ),
      upstreamPage: t('Run this bookmark on the upstream website Key page.'),
      openWebsite: t(
        'Return to hwjai, open the upstream website, then run this bookmark.'
      ),
      reopen: t('Return to hwjai and reopen the connection dialog.'),
      sent: t(
        'Key reading results were sent to hwjai. Keep both windows open for automatic refresh.'
      ),
      moneySent: t(
        'Balance reading results were sent to hwjai. Keep both windows open for automatic refresh.'
      ),
      failed: t('Connection failed. Return to hwjai and reconnect.'),
    },
  })
  const script = `void(async()=>{
    const c=${config};
    const discover=${discoverUpstreamPage.toString()};
    if(location.protocol!=="https:"||location.origin===c.destination){alert(c.labels.upstreamPage);return}
    if(!window.opener||window.opener.closed){alert(c.labels.openWebsite);return}
    if(window.hwjaiConnectionTimer)clearInterval(window.hwjaiConnectionTimer);
    if(window.hwjaiReadListener)removeEventListener("message",window.hwjaiReadListener);
    let pending=false;
    let currentNonce;
    async function renew(initial,requestId){
      if(pending)return;
      pending=true;
      let nonce;
      try{
        const challenge=await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{removeEventListener("message",receive);reject(Error(c.labels.reopen))},10000);
          function receive(event){
            if(event.source!==window.opener||event.origin!==c.destination||event.data?.type!=="hwjai-upstream-challenge"||typeof event.data.nonce!=="string")return;
            if(event.data.upstream_origin!==location.origin)return;
            clearTimeout(timer);removeEventListener("message",receive);resolve(event.data);
          }
          addEventListener("message",receive);
          window.opener.postMessage({type:"hwjai-upstream-request"},c.destination);
        });
        nonce=challenge.nonce;currentNonce=nonce;
        window.opener.postMessage({type:"hwjai-upstream-progress",nonce},c.destination);
        const currentPage=location.href.split('#')[0];
        const moneyOnly=challenge.money_only===true||(!!challenge.balance_page_url&&new URL(challenge.balance_page_url).href.split('#')[0]===currentPage&&new URL(challenge.key_page_url||'/keys',location.origin).href.split('#')[0]!==currentPage);
        const discovery=await discover(challenge.recipe,initial&&!requestId,c.labels,{balance_page_url:challenge.balance_page_url,money_only:moneyOnly});
        window.opener.postMessage({type:"hwjai-upstream-authorization",nonce,discovery,renewal:!initial,request_id:requestId},c.destination);
        if(initial&&!requestId)alert(discovery.money_only?c.labels.moneySent:c.labels.sent);
        return true;
      }catch(e){
        clearInterval(window.hwjaiConnectionTimer);
        if(nonce)window.opener.postMessage({type:"hwjai-upstream-disconnected",nonce,request_id:requestId,error:e.message},c.destination);
        if(initial)alert(e.message||c.labels.failed);
        return false;
      }finally{pending=false}
    }
    window.hwjaiReadListener=event=>{
      if(event.source!==window.opener||event.origin!==c.destination||event.data?.type!=="hwjai-upstream-read"||event.data.nonce!==currentNonce||typeof event.data.request_id!=="string")return;
      void renew(true,event.data.request_id);
    };
    addEventListener("message",window.hwjaiReadListener);
    if(await renew(true))window.hwjaiConnectionTimer=setInterval(()=>{
      if(!window.opener||window.opener.closed){clearInterval(window.hwjaiConnectionTimer);return}
      void renew(false);
    },240000);
  })()`
  return `javascript:${encodeURIComponent(script)}`
}
