/**
 * A very simple node.js HTTP proxy providing usage rate limiting using Redis.
 *
 * Author: Josh Devins (info@joshdevins.net, http://joshdevins.net)
 */

var sys = require("sys"),
    fs = require('fs'),
    http = require("http"),
    url = require("url");
var redis = require("./lib/node_redis.js");
var config = require("./config.js").config,
    utils = require("./utils.js");
    
// create Redis client
var redisClient = redis.createClient(config.redis_port, config.redis_host);

// flags to control dogpiling at race condition (a flag per key)
var dogpileControlFlags = {};

/**
 * Returns an object representing the current state of the limiter.
 */
function getStatus(x, y) {

    var ttl = y == -1 ? config.periodInSeconds : y;
    var requests = y == -1 ? 0 : parseInt(x);
    
    return {
        max_requests: config.maxRequests,
        requests: requests,
        remaining: requests > config.maxRequests ? 0 : config.maxRequests - requests,
        ttl: ttl,
        reset: utils.getSecondsSinceEpoch() + ttl
    }   
}

/**
 * Wraps #getStatus in headers for the HTTP response.
 */
function getStatusHeaders(x, y) {

    var status = getStatus(x, y);
    
    return {
        'X-RateLimit-MaxRequests' : status.max_requests,
        'X-RateLimit-Requests' : status.requests,
        'X-RateLimit-Remaining' : status.remaining,
        'X-RateLimit-TTL': status.ttl,
        'X-RateLimit-Reset': status.reset
    };
}

/**
 * Provided a key, lookup in Redis what the usage rate is and pass through if under limit. If over or at limit,
 * return an error code to the user.
 */
function lookupKeyAndProxyIfAllowed(request, response, key) {

    sys.log("Request received, usage rate lookup for key: " + key);
    
    var keyX = "X:" + key;
    var keyY = "Y:" + key;

    // add a callback here already to check if the request has already ended
    // skipping this seems to have the effect that 'end' event is cleared and thus response/proxy response below hangs forever
    var requestEnded = false;
    request.on('end', function() {
        requestEnded = true;
    });

    // increment X and check TTL on Y
    redisClient.multi()
        .incr(keyX)
        .ttl(keyY)
        .exec(function (err, replies) {

            x = replies[0];
            y = replies[1];

            sys.log("X:" + key + " = " + x);
            sys.log("Y:" + key + " = " + y);
            
            // case 1: TTL is expired, need to set X and Y
            if (y == -1 && !dogpileControlFlags[key]) {

                dogpileControlFlags[key] = true;

                redisClient.multi()
                    .set(keyX, 1)
                    .setex(keyY, config.periodInSeconds, 0)
                    .exec(function(e, r) {
                            // on success resetting the key TTL, delete flag
                            delete dogpileControlFlags[key];
                        });

                sys.log("TTL expired, proxying request for key: " + key);
                proxy(request, response, 1, config.periodInSeconds, requestEnded);
                return;
            }

            // case 2: TTL is not expired, verify we are under the limit of maxRequests
            if (x > config.maxRequests) {

                // rate limit reached
                sys.log("Usage rate limit hit: " + key);

                response.writeHead(403, getStatusHeaders(x, y));
                response.end();

                return;
            }

            sys.log("TTL not expired, number of requests under limit, proxying request for key: " + key);
            proxy(request, response, x, y, requestEnded);
        });
}

/**
 * Proxy the request to the upstream server.
 */
function proxy(request, response, x, y, requestEnded) {

    var hostSplit = request.headers.host.split(':');
    var host = hostSplit[0];
    var port = hostSplit[1];

    if (port == undefined) {
        port = {false : 80, true : 443}[request.socket.secure]
    }

    sys.log("Proxying to: " + host + ":" + port);

    var proxy = http.createClient(port, host, request.socket.secure);

    proxy.on('error', function(connectionException) {
        
        sys.log(connectionException);
        
        if (connectionException.errno === process.ECONNREFUSED) {
            
            // connection refused from upstream server                
            response.writeHead(504);
            response.write("Connection refused from upstream server: " + host + ":" + port + "\n");
            response.end();
        }
    });

    var proxy_request = proxy.request(request.method, request.url, request.headers);

    proxy_request.on('response', function(proxy_response) {
        
        proxy_response.on('data', function(chunk) {
            response.write(chunk, 'binary');
        });
      
        proxy_response.on('end', function() {
            response.end();
        });

        // add extra headers
        var headers = utils.mergeHeaders(proxy_response.headers, getStatusHeaders(x, y));

        response.writeHead(proxy_response.statusCode, proxy_response.headers);
    });
    
    request.on('data', function(chunk) {
        proxy_request.write(chunk, 'binary');
    });
    
    request.on('end', function() {
        proxy_request.end();
    });

    if (requestEnded) {
        proxy_request.end();
    }
}

function getStatusAndRespond(request, response, key) {
    
    sys.log("Status request received, usage rate lookup for key: " + key);
    
    var keyX = "X:" + key;
    var keyY = "Y:" + key;
    
    redisClient.multi()
        .get(keyX)
        .ttl(keyY)
        .exec(function (err, replies) {
            
            x = replies[0];
            y = replies[1];

            sys.log("X:" + key + " = " + x);
            sys.log("Y:" + key + " = " + y);

            response.writeHead(200);
            response.write(JSON.stringify(getStatus(x, y)));
            response.end();
        });
}

function serverCallback(request, response) {

    // test for status API calls
    var uri = url.parse(request.url);
    var path = uri.pathname;

    if (path.match("^" + config.statusPath) == config.statusPath) {
        
        key = path.substring(config.statusPath.length, path.length);
        getStatusAndRespond(request, response, key);
        return;
    }

    // get key from a configurable function
    // TODO: Check for null keys
    var key = config.buildKeyFunction(request);
    
    // TODO: case insensitive search for the header
    if (request.headers['x-ratelimit-status'] != null) {
        getStatusAndRespond(request, response, key);
        return;
    }

    lookupKeyAndProxyIfAllowed(request, response, key);
}

// TODO: move this somewhere so we can return a user error too
redisClient.on('error', function (err) {
    sys.log("Redis connection error to " + redisClient.host + ":" + redisClient.port + " - " + err);
});

// startup server
sys.log("Starting HTTP usage rate limiter proxy server on port: " + config.proxy_port);
http.createServer(serverCallback).listen(config.proxy_port);
