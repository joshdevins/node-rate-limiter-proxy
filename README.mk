HTTP Rate Limiting Proxy Server
===

A very simple node.js HTTP proxy providing usage rate limiting using Redis. This implementation has been tested against node.js v0.2.5 and Redis 2.0.4.

Usage
---

node http-rate-limiter.js

Sources
---

A list of other source code that went into this implementation:

 * [nodejs-proxy](https://github.com/pkrumins/nodejs-proxy) (short and simple node.js proxy, configuration reloading)

TODO
---

 * test HTTPS support
 * support setting the proxied request remote address to the same as the originating remote address (avoids need for X-Forwarded-For header)
 * add debug/metadata in response on remaining call quotas
 * externalize configuration (proxy port, Redis host:port, inject function to select Redis key given ServerRequest)

