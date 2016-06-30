
// This is the application Id for the Parse application you have setup for integration tests
// Settings this will enable certain cloud functions, such as deleting all the data in the database

module.exports.integrationAppId = '';

// This is used for 3rd party authentication to generate a password which is only known server-side
// Enter a random string (~8 characters is good) then delete the throw statement
module.exports.passwordPrefix = '1235';


module.exports.mailgun_domain = ''
module.exports.mailgun_key = ''
module.exports.mailgun_from = ''

module.exports.TWILIO_ACCOUNT_SID = '' // Twilio account id
module.exports.TWILIO_API_KEY = '' // https://www.twilio.com/user/account/video/dev-tools/api-keys
module.exports.TWILIO_API_SECRET = ''
module.exports.TWILIO_CONFIGURATION_SID = '' // Video Configuration Profile SID from https://www.twilio.com/user/account/video/profiles
