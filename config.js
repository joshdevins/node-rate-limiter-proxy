/**
 * A very simple node.js HTTP proxy providing usage rate limiting using Redis.
 *
 * Author: Josh Devins (info@joshdevins.net, http://joshdevins.net)
 */

var config = {
    proxy_port: 8080,
    redis_host: 'localhost',
    redis_port: 6379,
    maxRequests: 10,
    periodInSeconds: 60,
    statusPath: '/status/', // must start and end with forward slashes
    buildKeyFunction: function(request) {
        
        if (request.headers.authorization == null) {
            return '';
        }
        
        return request.headers.authorization.split(' ')[1];
    }
};

exports.config = config;
