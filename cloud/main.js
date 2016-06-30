// Remember the cloud code doesn't have the angular enhancement, so you will need to use the standard Parse API
// i.e. object.get('property') object.set('property', value)

var Profile = Parse.Object.extend("Profile");
var Match = Parse.Object.extend("Match");
var Report = Parse.Object.extend("Report");
var ChatMessage = Parse.Object.extend("ChatMessage");
var DeletedUser = Parse.Object.extend("DeletedUser");

var _ = require('underscore');


// Configuration

// Set these params to true so users can't update their own birthday - then the only way to update is through
// a cloud function e.g CopyFacebookProfile (which will set the masterKey)
var RESTRICT_BIRTHDATE = false;
var RESTRICT_NAME = false;
var RESTRICT_GENDER = false;

// Minimum age in years, or null if not required
var MINIMUM_AGE = 18;

// This should match the ceiling attribute in the maximum age slider in the discovery preferences
// so when the user selects the maximum value, its all ages above that too, i.e. 55+
var MAX_AGE_PLUS = 55;

Parse.Cloud.beforeSave(Parse.User, function(request, response) {
	var user = request.object;

	if(user.id == null) {
		user.set('admin', false);
		user.set('premium', false);
		user.set('credits', 0);
		user.set('matches', []);

		var acl = new Parse.ACL();
		acl.setPublicReadAccess(false);
		acl.setPublicWriteAccess(false);
		user.setACL(acl);

	} else if(!request.master) {
		if(user.dirty('admin'))
			return response.error('You cant set the admin flag');
		if(user.dirty('premium'))
			return response.error('You cant set the premium flag');
		if(user.dirty('credits'))
			return response.error('You cant set the credits');
	}


	// Extract the facebook user id to its own column, if it has changed
	var fbId = user.get('fbId');
	var fbAuth = user.get('authData');
	if(fbAuth && fbAuth.facebook && fbId !== fbAuth.facebook.id)
		user.set('fbId', fbAuth.facebook.id);

	response.success();
});
