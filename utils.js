
/**
 * Returns the number of seconds since epoch, aka Unix time.
 */
exports.getSecondsSinceEpoch = function() {
    return Math.round(new Date().getTime() / 1000);
}

/**
 * Merges sets of headers very simply. Might want to get fancy later by doing things like looking at X-Forwarded-For and appending to it.
 */
exports.mergeHeaders = function(headers1, headers2) {

    for (attrname in headers2) {
        headers1[attrname] = headers2[attrname];
    }
}
