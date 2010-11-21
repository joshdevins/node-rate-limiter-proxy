
var config = {
    proxy_port: 8080,
    redis_host: 'localhost',
    redis_port: 6379,
    maxRequests: 10,
    periodInSeconds: 60,
    statusPath: '/status/', // must start and end with forward slashes
    buildKeyFunction: function(request) {
        
        if (request.headers.authorization == null) {
            return null;
        }
        
        return request.headers.authorization.split(' ')[1];
    }
};

exports.config = config;
