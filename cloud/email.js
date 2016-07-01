/**
 * Module for sending email which uses the Mailgun implementation
 */
var config = require('../config.js')
var Mailgun = require('mailgun-js')

var exports = module.exports = {}

var configured = config.mailgun_domain && config.mailgun_key && config.mailgun_from
configured = false
if(configured)
	Mailgun.initialize(config.mailgun_domain, config.mailgun_key)
else
	console.log('Email sending is not configured')


exports.sendEmail = function (to, subject, text) {
	if(!configured) {
		console.log('Email sending is not configured - could not send email')
		return Parse.Promise.as()
	}

	return Mailgun.sendEmail({
		to: to,
		from: config.mailgun_from,
		subject: subject,
		text: text
	})
}


exports.sendAdminEmail = function(subject, text) {
	if(!configured) {
		console.log('Email sending is not configured - could not send email')
		return Parse.Promise.as()
	}

	return Mailgun.sendEmail({
		to: config.mailgun_from,
		from: config.mailgun_from,
		subject: subject,
		text: text
	})
}
