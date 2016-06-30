
/**
 * Module for sending email which uses the Mailgun implementation
 */
var config = require('./config.js');
var Mailgun = require('mailgun');

var _exports = module.exports = {};

var configured = config.mailgun_domain && config.mailgun_key && config.mailgun_from;

if (configured) Mailgun.initialize(config.mailgun_domain, config.mailgun_key);else console.log('Email sending is not configured');

_exports.sendEmail = function (to, subject, text) {
	if (!configured) {
		console.log('Email sending is not configured - could not send email');
		return Parse.Promise.as();
	}

	return Mailgun.sendEmail({
		to: to,
		from: config.mailgun_from,
		subject: subject,
		text: text
	});
};

_exports.sendAdminEmail = function (subject, text) {
	if (!configured) {
		console.log('Email sending is not configured - could not send email');
		return Parse.Promise.as();
	}

	return Mailgun.sendEmail({
		to: config.mailgun_from,
		from: config.mailgun_from,
		subject: subject,
		text: text
	});
};