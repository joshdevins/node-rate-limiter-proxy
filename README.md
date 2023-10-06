HTTP Rate Limiting Proxy Server
===

A very simple node.js HTTP proxy providing usage rate limiting using Redis. This implementation has been tested against node.js v0.2.5 and Redis v2.0.4.

Basic Usage
---

	node node-rate-limiter-proxy.js
	
If you use something like <code>curl</code> to make requests to the proxy, you will see some extra headers that help you understand the current state of the limiter in Redis. The custom headers used are very similar to those in the [Twitter API](http://dev.twitter.com/pages/rate_limiting_faq#checking).

	$ curl -v --header "Host: localhost:80" http://josh:devins@localhost:8080/

	> GET / HTTP/1.1
	> Authorization: Basic am9zaDpkZXZpbnM=
	> User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8l zlib/1.2.3
	> Accept: */*
	> Host: localhost
	> 
	< HTTP/1.1 200 OK
	< date: Sat, 20 Nov 2010 23:35:27 GMT
	< server: Apache/2.2.15 (Unix) mod_ssl/2.2.15 OpenSSL/0.9.8l DAV/2
	...
	< X-RateLimit-MaxRequests: 10
	< X-RateLimit-Requests: 1
	< X-RateLimit-Remaining: 9
	< X-RateLimit-TTL: 60
	< X-RateLimit-Reset: 1290342852

You will also need to either set your client to use a proxy or explicitly set the <code>Host</code> header when testing since this is what the proxy uses to determine the destination for the proxied request. This is particularly important when both proxy and upstream server are running on <code>localhost</code> otherwise you will get into an endless loop.

Configuration
---

All configuration is in <code>config.js</code>. This includes a function to determine how to build the access key. An access key is what is used to uniquely identify a user or set of users whose access rates you want to control. By default, the key is built from the <code>Authentication</code> header, however it could just as easily be built up from the source IP address or request path.

API Usage
---

Included is a very basic API allowing a client to fetch the current state of the rate limiter for either: an arbitrary key or an exact URL/request.

To retrieve an arbitrary key, the key might first need to be URL encoded. There needs to be some insight into the white box that is the proxy since the client needs to be aware of how the key is built. Since the default is to use the Authentication header as the key, I already have a URL encoded value (see the request headers in the first example of basic usage). The <code>status</code> URI path is configurable as well in case that collides with a URI on the backing/proxied server.

    $ curl http://localhost:8080/status/am9zaDpkZXZpbnM=
	{"max_requests":10,"requests":3,"remaining":7,"ttl":16,"reset":1290347995}

To test the status of the rate limiter for a specific request, just add the header <code>X-RateLimit-Status</code> to a regular request. This will *NOT* send a request to the backing server but instead just return the status object.

	$ curl --header 'X-RateLimit-Status: true' --header 'Host: localhost' http://josh:devins@localhost:8080/this/is/the/path
	{"max_requests":10,"requests":0,"remaining":10,"ttl":60,"reset":1290348148}

At the moment, only JSON responses are supported however this can easily be extended.

TODO
---

 * better Redis failure handling mid-request
 * HTTPS support
 * ensure race condition goes away between TTL expiry check and reset (upstream server can get stampeded)
   * optimistic locking in Redis (requires Redis 2.1.0)

Acknowledgements
---

 * [node_redis](http://github.com/mranney/node_redis) (Redis library)
 * [nodejs-proxy](https://github.com/pkrumins/nodejs-proxy) (short and simple basis for the core proxy code, configuration example)
 * [HTTP client connection error handling](http://rentzsch.tumblr.com/post/664884799/node-js-handling-refused-http-client-connections)
