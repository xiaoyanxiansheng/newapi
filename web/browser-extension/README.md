# hwjai 上游连接助手

适用于 Chrome / Edge。基于 new-api（QuantumNous），采用 AGPL-3.0 许可。

1. 解压此目录并保留。
2. 打开 chrome://extensions 或 edge://extensions，启用开发者模式。
3. 点击“加载已解压的扩展程序”，选择包含 manifest.json 的目录。
4. 刷新 hwjai 的上游渠道页面。点击“一键连接”，完成必要的网站登录后点击“一键授权”。
5. 首次访问或新增网站时，扩展会列出域名，一次允许此批次的访问。之后可直接复用已授权的网站。

连接会复用现有标签页和登录；登录失效、验证码、Google 等登录仍需本人完成。不能在互不相关的网站间共享登录。

扩展只读上游已有 Key、已加入的线路、报价和金额。现有 Key 的显示接口可能为 POST；不会创建或编辑 Key。Cookie 不会发给 hwjai，不使用 cookies 或 webRequest 权限。只对管理员选择且浏览器明确允许的 HTTPS 网站读取，结果发回发起请求的 hwjai 页面；不保存读取到的密钥、余额或会话。Chrome 自身会保存域名访问授权。

支持 https://hwjai.me 和本地 3001 的管理员页面。部分网站需要先展开 Key，或使用既有的页面选择/书签流程完成首次识别；扩展不会绕过网站登录或读取权限。

目录更新后，在扩展页面点重新加载即可。源码包含通用只读读取器，来源：https://github.com/QuantumNous/new-api。
