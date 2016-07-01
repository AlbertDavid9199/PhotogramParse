// Example express application adding the parse-server module to expose Parse
// compatible API routes.

var express = require('express')
var bodyParser = require('body-parser')
var ParseServer = require('parse-server').ParseServer
var path = require('path')
var config = require('./config.js')
var parseConfig = require('./parse-config.js')

console.log('Parse config:', parseConfig)

// Make sure the Mongo indexes are up to date
require('./mongo-indexes.js')(parseConfig.databaseURI)

var api = new ParseServer(parseConfig)

var app = express()
app.set('views', 'cloud/views')  // Specify the folder to find templates
app.set('view engine', 'ejs')    // Set the template engine
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

// See HTTPS and forwarding proxies
// https://cloud.google.com/appengine/docs/flexible/nodejs/runtime
if(process.env.GAE_LONG_APP_ID)
    app.set('trust_proxy', 1)

// Serve static assets from the /public folder
app.use('/public', express.static(path.join(__dirname, '/public')))

// Same as from node_modules/parse-server/lib/middlewares.js
var allowCrossDomain = function allowCrossDomain(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    res.header('Access-Control-Allow-Headers', 'X-Parse-Master-Key, X-Parse-REST-API-Key, X-Parse-Javascript-Key, X-Parse-Application-Id, X-Parse-Client-Version, X-Parse-Session-Token, X-Requested-With, X-Parse-Revocable-Session, Content-Type')

    // intercept OPTIONS method
    if ('OPTIONS' == req.method)
        res.sendStatus(200)
    else
        next()
}
app.use(allowCrossDomain)




// Serve the Parse API on the /parse URL prefix
var mountPath = process.env.PARSE_MOUNT || config.parseMount
console.log('Mounting Parse API at ' + mountPath)
app.use(mountPath, api)

// Parse Server plays nicely with the rest of your web routes
app.get('/', function(req, res) {
  res.status(200).send('Parse server is running')
})

// There will be a test page available on the /test path of your server url
// Remove this before launching your app
// app.get('/test', function(req, res) {
//   res.sendFile(path.join(__dirname, '/public/test.html'))
// })


// Client logging route

// var ClientLog = Parse.Object.extend('ClientLog')

app.post('/client-log', function(req, res) {
    saveClientLog(res, req.body.userId, req.body.message, req.body.recent, req.body.appVersion, req.body.platform, req.body.platformVersion)
})
app.get('/client-log', function(req, res) {
    saveClientLog(res, req.query.userId, req.query.message, req.query.recent, req.query.appVersion, req.query.platform, req.query.platformVersion)
})

function saveClientLog(response, userId, message, recent, appVersion, platform, platformVersion) {
    response.set('Content-Type', 'text/plain')

    console.error('ClientError','userId', userId,'message', message,'appVersion', appVersion,'platform', platform,'platformVersion', platformVersion, 'recent', recent)
    response.send('OK')
    /*
     var clientLog = new ClientLog()
     clientLog.set('userId', userId)
     clientLog.set('message', message)
     clientLog.set('appVersion', appVersion)
     clientLog.set('platform', platform)
     clientLog.set('platformVersion', platformVersion)
     try {
     if(recent)
     clientLog.set('recent', JSON.parse(recent))
     } catch(e) {}

     clientLog.save().then(function() {
     response.send('OK')
     }, function(error) {
     response.send('ERROR ' + JSON.stringify(error))
     })
     */
}



var port = process.env.PORT || 1337
var httpServer = require('http').createServer(app)
httpServer.listen(port, function() {
    console.log('Parse server running on port ' + port + '.')
})

// This will enable the Live Query real-time server
// ParseServer.createLiveQueryServer(httpServer);
