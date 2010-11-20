HTTP Rate Limiting Proxy Server
===

A very simple node.js HTTP proxy providing usage rate limiting using Redis. This implementation has been tested against node.js v0.2.5 and Redis 2.0.4.

Usage
---

	node http-rate-limiter.js

Implementation Notes
---

Due to the way Redis <2.1.3 [treats volatile keys](http://code.google.com/p/redis/wiki/ExpireCommand), several steps are needed when dealing with the rate limiting. Here is a rundown of the steps that are taken against Redis <2.1.3 to achieve incrementing volatile keys. This example uses <code>redis-cli</code> as an illustration tool and so you can test the semantics yourself or re-use them elsewhere.

    $ redis-cli

The first step is to create two keys, X and Y representing X requests in Y seconds. In this example, we'll use 60 seconds as the rate period and 10 as the maximum number of requests allowed in those 60 seconds. Because of the Redis limitation on volatile keys, the key prefixed with "Y:" will actually be the timing/expiration key only and not used to store the number of accesses in this timeframe. So for this key, the value is actually irrelevant since it will never be read or changed. The key prefixed with "X:" will keep track of the number of requests in the time period. We'll assume neither is yet set and set them both right now in one atomic transaction in Redis.

    redis> MULTI
	OK
	redis> SET X:foo 1
	QUEUED
	redis> SETEX Y:foo 60 1
	QUEUED
	redis> EXEC
	1. OK
	2. OK
	redis> MGET X:foo Y:foo
	1. "1"
	2. "1"
	redis> TTL Y:foo
	(integer) 56 <-- this is the number of seconds left for the key to "live" so will vary slightly depending on when you call TTL

Now that we have both keys X and Y for resource "foo", we can pretend to access "foo" for a subsequent request.

The first thing to do is test if the rate period (TTL of key Y) has been reached. If so, then we simple loop back and act as if this is the first ever access against this key, as above.

	redis> TTL Y|foo
	(integer) -1

Here the key has expired so we would just run the same set of commands as above. Should the expiry time not be reached, we need to do something else.

	redis> TTL Y|foo
	(integer) 40
	
We can now be optimistic and just increment key X and check what the value would be if the access were to be allowed.

	redis> INCR X|foo
	(integer) 2
	
This is fine since the value is still less than our maximum allowed 10 requests per 60 seconds. So we let the request through. A few calls later we get into the following situation.
	
	redis> INCR X|foo
	(integer) 11
	
Okay, now it's clear that if this request were to be let through we would exceed the maximum 10 requests per 60 seconds. In this case, we just deny the incoming request. We don'y need to decrement the key since the next request would just look like this.

	redis> INCR X|foo
	(integer) 12
	
Since this is still beyond 10, we can just keep incrementing away the attempts. In reality, this actually gives us some useful insight. Before we reset this key, we can record this value to disk somewhere for statistics purposes. This will give us an idea of how far beyond people's allowable limit they are attempting to go. Of course, the downside is that you continue to increment this value and possibly reach the maximum integer value. If incrementing is not for you, you can always be pessimistic and just do a check before allowing the request and incrementing the counter.

	redis> GET X|foo
	"9"
	redis> INCR X|foo
	(integer) 10
	
This does require two calls for every successful request, but will avoid running out of integers if you were to increment forever.

Now that the value of X is beyond the maximum, we have to wait for the TTL to expire before allowing more requests.

	redis> TTL Y|foo
	(integer) -1

When we see this, we simply go back to the first set of commands, resetting the X key and expiring Y.

	redis> MULTI
	OK
	redis> SET X:foo 1
	QUEUED
	redis> SETEX Y:foo 60 1
	QUEUED
	redis> EXEC
	1. OK
	2. OK
	
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
