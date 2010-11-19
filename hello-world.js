var sys = require("sys"),
    http = require("http"),
    url = require("url");

http.createServer(function(request, response) {

    var method = request.method;
    
    var urlObj = url.parse(request.url);
    var uri = urlObj.pathname;
    var auth = urlObj.auth;

    response.writeHead(200, {"Content-Type": "text/html"});
    response.write("method: " + method + "\n");
    response.write("URI: " + uri + "\n");
    response.write("Auth: " + auth + "\n");
    response.end();

}).listen(8080);
  
sys.puts("Server running at http://localhost:8080/");
