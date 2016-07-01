var Config = require('../config.js')
var AccessToken = require('./AccessToken.js')
var ConversationsGrant = AccessToken.ConversationsGrant

Parse.Cloud.define('GetTwilioToken', function (request, response) {
	return response.error('NOT_CONFIGURED')
	var identity = request.user.id

	// Create an access token which we will sign and return to the client,
	// containing the grant we just created
	var token = new AccessToken(Config.TWILIO_ACCOUNT_SID, Config.TWILIO_API_KEY, Config.TWILIO_API_SECRET)

	// Assign the identity to the token
	token.identity = identity

	// Grant the access token Twilio Video capabilities
	var grant = new ConversationsGrant()
	grant.configurationProfileSid = Config.TWILIO_CONFIGURATION_SID
	token.addGrant(grant)

	// Serialize the token to a JWT string and include it in a JSON response
	response.success({
		identity: identity,
		token: token.toJwt()
	})
})