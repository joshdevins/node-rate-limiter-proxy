/**
 * A very simple node.js HTTP proxy providing usage rate limiting using Redis.
 *
 * Author: Josh Devins (info@joshdevins.net, http://joshdevins.net)
 */

var sys = require("sys"),
    http = require("http"),
    url = require("url");
var redis = require("./lib/node_redis.js");
var utils = require("./utils.js");

var config = {
    proxy_port: 8080,
    maxRequests: 10,
    periodInSeconds: 60
};

/**
 * Returns X headers given the current state of the limiter.
 */
function getExtraHeaders(x, y) {

    var remaining = x > config.maxRequests ? 0 : config.maxRequests - x;

    return {
        'X-RateLimit-MaxRequests' : config.maxRequests,
        'X-RateLimit-Requests' : x,
        'X-RateLimit-Remaining' : remaining,
        'X-RateLimit-TTL' : y,
        'X-RateLimit-Reset' : utils.getSecondsSinceEpoch() + y };
}

/**
 * Provided a key, lookup in Redis what the usage rate is and pass through if under limit. If over or at limit,
 * return an error code to the user.
 */
function lookupKeyAndProxyIfAllowed(request, response, key) {

    sys.log("Usage rate lookup: " + key);
    
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

            sys.log("X: " + x);
            sys.log("Y: " + y);
            
            // case 1: TTL is expired, need to set X and Y
            if (y == -1) {
                redisClient.multi()
                    .set(keyX, 1)
                    .setex(keyY, config.periodInSeconds, 0)
                    .exec();

                sys.log("TTL expired, proxying request for key: " + key);
                proxy(request, response, 1, config.periodInSeconds, requestEnded);
                return;
            }

            // case 2: TTL is not expired, verify we are under the limit of maxRequests
            if (x > config.maxRequests) {

                // rate limit reached
                sys.log("Usage rate limit hit: " + key);

                response.writeHead(403, getExtraHeaders(x, y));
                response.end();

                return;
            }

            sys.log("TTL not expired, number of requests under limit, proxying request for key: " + key);
            proxy(request, response, x, y, requestEnded);
        });
}

/**
 * Proxy the request to the destination service.
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
    var proxy_request = proxy.request(request.method, request.url, request.headers);

    proxy_request.on('response', function(proxy_response) {
        
        proxy_response.on('data', function(chunk) {
            response.write(chunk, 'binary');
        });
      
        proxy_response.on('end', function() {
            response.end();
        });

        // add extra headers
        var headers = utils.mergeHeaders(proxy_response.headers, getExtraHeaders(x, y));

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

function serverCallback(request, response) {

    var auth = request.headers.authorization;
    var key = auth.split(' ')[1];

    lookupKeyAndProxyIfAllowed(request, response, key);
}

// create Redis client
var redisClient = redis.createClient(6379, 'localhost');

// move this somewhere so we can return a user error too
redisClient.on("error", function (err) {
    sys.log("Redis connection error to " + redisClient.host + ":" + redisClient.port + " - " + err);
});

// startup server
sys.log("Starting HTTP usage rate limiter proxy server on port: " + config.proxy_port);
http.createServer(serverCallback).listen(config.proxy_port);
