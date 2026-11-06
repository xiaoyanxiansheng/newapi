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
const id = location.hash.slice(1)
const button = document.querySelector('#authorize')
const status = document.querySelector('#status')
const request = (operation) =>
  chrome.runtime.sendMessage({
    operation,
    job_id: id,
    request_id: crypto.randomUUID(),
  })
const reply = await request('job')
if (reply.error) {
  status.textContent = '授权请求已过期或无效，请回到 hwjai 重新点击“一键授权”。'
} else {
  for (const account of reply.result.accounts) {
    const item = document.createElement('li')
    item.textContent = `${account.name} · ${new URL(account.url).origin}`
    document.querySelector('#websites').append(item)
  }
  button.disabled = false
  status.textContent = '点击后，一次授权以上所有网站。'
  button.addEventListener('click', async () => {
    button.disabled = true
    try {
      const granted = await chrome.permissions.request({
        origins: reply.result.origins,
      })
      if (!granted) {
        status.textContent = '尚未允许网站访问，可以重新点击授权。'
        return
      }
      status.textContent =
        '正在读取，完成后结果会显示在 hwjai。请保持此窗口打开。'
      const result = await request('approve')
      status.textContent = result.error
        ? '读取未完成，请回到 hwjai 查看提示并重新授权。'
        : '已将读取结果发送到 hwjai，可以关闭此页面。'
    } catch {
      status.textContent = '授权未完成，请回到 hwjai 重新点击“一键授权”。'
    } finally {
      button.disabled = false
    }
  })
}
