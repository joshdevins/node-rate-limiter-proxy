/**
 * A very simple node.js HTTP proxy providing API usage control using Redis. For now, this is intended
 * to be forked to change the configuration and what parts of the HTTP request are used as API keys.
 *
 * Sources: https://github.com/pkrumins/nodejs-proxy
 *
 * Author: Josh Devins (info@joshdevins.net, http://joshdevins.net)
 */

var sys = require("sys"),
    http = require("http"),
    url = require("url");

var config = {
    proxy_port: 8080
};

/**
 * Proxy the request to the destination service.
 */
function proxy(request, response) {
    
    var host = request.headers['host'].split(':');
    var proxy = http.createClient(host[1] || 80, host[0])
    var proxy_request = proxy.request(request.method, request.url, request.headers);

    proxy_request.addListener('response', function(proxy_response) {

      proxy_response.addListener('data', function(chunk) {
        response.write(chunk, 'binary');
      });

      proxy_response.addListener('end', function() {
        response.end();
      });

      response.writeHead(proxy_response.statusCode, proxy_response.headers);
    });

    request.addListener('data', function(chunk) {
      proxy_request.write(chunk, 'binary');
    });

    request.addListener('end', function() {
      proxy_request.end();
    });
}

function serverCallback(request, response) {

    var auth = request.headers.authorization;
    var method = request.method;
    var uri = url.parse(request.url).pathname;

    proxy(request, response);
}

// startup server
sys.log("Starting HTTP proxy server on port: " + config.proxy_port);
http.createServer(serverCallback).listen(config.proxy_port);
