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

 * better Redis failure handling
 * case insensitive search for the status header: X-RateLimit-Status
 * check for null keys from key generate function
 * support setting the proxied request remote address to the same as the originating remote address (avoids need for <code>X-Forwarded-For</code> header)
 * HTTPS support
 * ensure race condition goes away between TTL expiry check and reset (upstream server can get stampeded)
   * optimistic locking in Redis (requires Redis 2.1.0)

Acknowledgements
---

 * [nodejs-proxy](https://github.com/pkrumins/nodejs-proxy) (short and simple basis for the core proxy code, configuration example)
 * [HTTP client connection error handling](http://rentzsch.tumblr.com/post/664884799/node-js-handling-refused-http-client-connections)

Implementation Notes
---

Due to the way Redis <2.1.3 [treats volatile keys](http://code.google.com/p/redis/wiki/ExpireCommand), several steps are needed when dealing with the rate limiting. Here is a rundown of the steps that are taken against Redis <2.1.3 to achieve incrementing volatile keys. This example uses <code>redis-cli</code> as an illustration tool and so you can test the semantics yourself or re-use them elsewhere.

    $ redis-cli

The first step is to use two keys, X and Y representing X requests in Y seconds. In this example, we'll use 60 seconds as the rate period and 10 as the maximum number of requests allowed in those 60 seconds. Because of the Redis limitation on volatile keys, the key prefixed with "Y:" will actually be the timing/expiration key only and not used to store the number of accesses in this timeframe. So for this key, the value is actually irrelevant since it will never be read or changed. The key prefixed with "X:" will keep track of the number of requests in the time period. We'll assume neither is yet set and get both values from Redis. This is best done in a transaction so we can send just one request to Redis and have guarantees about consistency between the two values.

	redis> MULTI
	OK
	redis> GET X:foo
	QUEUED
	redis> TTL Y:foo
	QUEUED
	redis> EXEC
	1. (integer) -1
	2. (integer) -1

Since we've never set either of these keys, it's no wonder that they are both -1. The next step is to of course start incrementing the X counter and set the Y key to start counting down.

    redis> MULTI
	OK
	redis> SET X:foo 1
	QUEUED
	redis> SETEX Y:foo 60 0
	QUEUED
	redis> EXEC
	1. OK
	2. OK

Some introspection on the keys in Redis shows us their current values.

	redis> MGET X:foo Y:foo
	1. "1"
	2. "0"
	redis> TTL Y:foo
	(integer) 56 <-- this is the number of seconds left for the key to "live" so will vary slightly depending on when you call TTL

Now that we have both keys X and Y for resource "foo" we can let the request through.

Let's now keep going and imagine what subsequent requests would look like. Normally we wouldn't actually do a GET on the X value but instead would be optimistic and increment the value while we check the TTL of key Y.

	redis> MULTI
	OK
	redis> INCR X:foo
	QUEUED
	redis> TTL Y:foo
	QUEUED
	redis> EXEC
	1. (integer) 5
	2. (integer) -1

Here we have the case where the resource has been accessed 4 times before (this would be the 5th access) but the TTL or Y value has been reached. In this case, we simply have to reset everything before letting the request through.

	redis> MULTI
	OK
	redis> SET X:foo 1
	QUEUED
	redis> SETEX Y:foo 60 0
	QUEUED
	redis> EXEC
	1. OK
	2. OK

Should the expiry time not be reached, we need to do something else.

	redis> MULTI
	OK
	redis> INCR X:foo
	QUEUED
	redis> TTL Y:foo
	QUEUED
	redis> EXEC
	1. (integer) 11
	2. (integer) 30

Okay, now it's clear that if this request were to be let through we would exceed the maximum 10 requests per 60 seconds. In this case, we just deny the incoming request. We don't need to decrement the key since the next request would still result in a denial: 12 > 10. In reality, this actually gives us some useful insight. Before we reset this key, we can record this value to disk somewhere for statistics purposes. This will give us an idea of how far beyond people's allowable limit they are attempting to go. Of course, the downside is that you continue to increment this value and possibly reach the maximum integer value. If incrementing is not for you, you can always be pessimistic and just do a check before allowing the request and incrementing the counter.

	redis> GET X|foo
	"9"
	redis> INCR X|foo
	(integer) 10

This does require two calls for every successful request, but will avoid running out of integers if you were to increment forever.

Of course, once Redis >=2.1.3 is stable and released, this algorithm becomes a bit simpler since it will require only one key to be operated on.
