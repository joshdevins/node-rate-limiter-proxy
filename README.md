HTTP Rate Limiting Proxy Server
===

A very simple node.js HTTP proxy providing usage rate limiting using Redis. This implementation has been tested against node.js v0.2.5 and Redis 2.0.4.

Usage
---

	node nodejs-http-rate-limiter.js

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

Sources
---

A list of other source code that went into this implementation:

 * [nodejs-proxy](https://github.com/pkrumins/nodejs-proxy) (short and simple node.js proxy, configuration reloading)

TODO
---

 * test HTTPS support
 * support setting the proxied request remote address to the same as the originating remote address (avoids need for <code>X-Forwarded-For</code> header)
 * add debug/metadata in response on remaining call quotas
 * externalize configuration and make reloadable
   * proxy port
   * Redis host:port
   * inject JS function to select Redis key given ServerRequest
