
// These two lines are required to initialize Express in Cloud Code.
 express = require('express')
 app = express()

// Global app configuration section
app.set('views', 'cloud/views')  // Specify the folder to find templates
app.set('view engine', 'ejs')    // Set the template engine
app.use(express.bodyParser())    // Middleware for reading request body


app.use(function(req, res, next) {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept'
    })
    next()
})


// Client logging routes ----------------

var ClientLog = Parse.Object.extend("ClientLog")

app.post('/client-log', function(req, res) {
    saveClientLog(res, req.body.userId, req.body.message, req.body.recent, req.body.appVersion, req.body.platform, req.body.platformVersion)
})
app.get('/client-log', function(req, res) {
    saveClientLog(res, req.query.userId, req.query.message, req.query.recent, req.query.appVersion, req.query.platform, req.query.platformVersion)
})

function saveClientLog(response, userId, message, recent, appVersion, platform, platformVersion) {
    response.set('Content-Type', 'text/plain')
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
        response.send('ERROR' + error)
    })
}

// --


// Attach the Express app to Cloud Code.
app.listen()
