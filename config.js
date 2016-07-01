// simple module so we only read it from the filesystem once
// and it could be updated to apply environment variables
// or more dynamic configuration
var jsonfile = require('jsonfile')
var configFile = process.env.CONFIG_FILE || 'config.json'
var config = jsonfile.readFileSync(configFile)
module.exports = config
