/**
 * A very simple node.js HTTP proxy providing usage rate limiting using Redis.
 *
 * Author: Josh Devins (info@joshdevins.net, http://joshdevins.net)
 */

/**
 * Returns the number of seconds since epoch, aka Unix time.
 */
exports.getSecondsSinceEpoch = function() {
    return Math.round(new Date().getTime() / 1000);
}

/**
 * Merges sets of headers very simply.
 */
exports.mergeHeaders = function(headers1, headers2) {

    for (attrname in headers2) {
        headers1[attrname] = headers2[attrname];
    }
}

/**
 * Given a Node ServerRequest object, determine the new X-Forwarded-For header for upstream server in the proxied request.
 */
exports.getNewXForwardedForHeader = function(request) {
    
    var value = request.headers['x-forwarded-for'];
    
    if (value != null) {
        return value + ", " + request.socket.remoteAddress;
    } else {
        return request.socket.remoteAddress;
    }
}
