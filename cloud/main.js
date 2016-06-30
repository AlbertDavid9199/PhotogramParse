// Remember the cloud code doesn't have the angular enhancement, so you will need to use the standard Parse API
// i.e. object.get('property') object.set('property', value)

var Profile = Parse.Object.extend("Profile");
var Match = Parse.Object.extend("Match");
var Report = Parse.Object.extend("Report");
var ChatMessage = Parse.Object.extend("ChatMessage");
var DeletedUser = Parse.Object.extend("DeletedUser");

var _ = require('underscore');

var config = require('./config.js');
var Email = require('./email.js');

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


// Note that the saving of the profile to the user happens after the
// user object is returned, so it would need to be refreshed by the client
// to see the profile link when first saved
Parse.Cloud.afterSave(Parse.User, function(request) {
	var user = request.object;

	var profile = user.get('profile');

	// When creating a new User link the profile object
	if(!profile) {
		profile = new Profile();
		profile.set('uid', user.id); // Need to set this here for Profile.beforeSave
		Parse.Cloud.useMasterKey();
		return profile.save().then(function(profile) {
			user.set('profile', profile);
			return user.save().then(function() {}, function(error) {
				console.error('error saving profile ' + profile.id + ' to user ' + user.id + ' ' + JSON.stringify(error));
			})
		}, function(error) {
			console.error('Error creating profile for user ' + user.id + ' ' + JSON.stringify(error));
		});
	}
});

Parse.Cloud.define('PostLogin', function(request, response) {
	// return 'UPDATE_REQUIRED' when you have switched over to the self-hosted parse server
	response.success("");
});

Parse.Cloud.beforeSave(Profile, function(request, response) {
	var profile = request.object;
	var userId;

	// If we have strict controls on certain fields then don't let a custom client update them
	if(!request.master) {
		if(RESTRICT_BIRTHDATE && profile.dirty('birthdate')) {
			response.error('Cannot update birthdate');
			return;
		}
		if(RESTRICT_NAME && profile.dirty('name')) {
			response.error('Cannot update name');
			return;
		}
		if(RESTRICT_GENDER && profile.dirty('gender')) {
			response.error('Cannot update gender');
			return;
		}
		// An example if you wanted to limit the number of times a user can update their birthday
		/*
		var bdayCount = request.user.get('birthdayUpdateCount')
		if(!_.isNumber(bdayCount)) bdayCount = 0
		if(profile.dirty('birthdate') && bdayCount >= 2) {
		   response.error('Cannot update birthdate more than 2 times')
		   return
		}
		*/
	}

	if(!profile.id) { // Creating a new Profile object
		// request.user can be null (either from a brand new user or using master key)
		userId = request.user ? request.user.id : profile.get('uid');
		if(!userId) {
			response.error('Could not determine user Id for new profile');
			return;
		}

		profile.set('photos', []);
		profile.set('enabled', false);
		profile.set('gps', true);
		profile.set('about', '');
		profile.set('distance', 25);
		profile.set('distanceType', 'km');
		profile.set('notifyMatch', true);
		profile.set('notifyMessage', true);

		var acl = new Parse.ACL(userId);
		acl.setPublicWriteAccess(false);
		acl.setPublicReadAccess(false);
		acl.setWriteAccess(userId, true);
		acl.setReadAccess(userId, true);
		profile.setACL(acl);

	} else { // Saving an existing Profile

		if(profile.dirty('birthdate')) {
			var birthdate = profile.get('birthdate'), ageFrom = profile.get('ageFrom'), ageTo = profile.get('ageTo');
			if(birthdate) {
				var age = _calculateAge(birthdate);
				if(!ageFrom) {
					ageFrom = age - 5;
					if(ageFrom < 18) ageFrom = 18;
					profile.set('ageFrom', ageFrom);
				}
				if(!ageTo) {
					ageTo = age + 5;
					if(ageTo > 55) ageTo = 55;
					profile.set('ageTo', ageTo);
				}
			}
		}
		if(profile.dirty('gender')) {
			var gender = profile.get('gender');
			if(!profile.has('guys'))
				profile.set('guys', gender !== 'M');
			if(!profile.has('girls'))
				profile.set('girls', gender !== 'F');
		}

		/*
		//This is only required if you have users with an older version using old data model with photo1, photo2, photo3

		var photo1 = profile.get('photo1')
		var photo2 = profile.get('photo2')
		var photo3 = profile.get('photo3')

		// If doing an update of the old model, then update the new model
		if(request.photo1 || request.photo2 || request.photo3) {
			var photos = []
			// check !== null in case the user is deleting it
			if(photo1 || (request.photo1 && request.photo1 !== null))
				photos.push(photo1)
			if(photo2 || (request.photo2 && request.photo2 !== null))
				photos.push(photo2)
			if(photo3 || (request.photo3 && request.photo3 !== null))
				photos.push(photo3)
		}

		// If doing an update of the new model, then update the old model
		if(request.photos) {
			var i
			for(i = 0; i < 3; i++) {
				if(i < request.photos.length)
					profile.set('photo' + (i+1), request.photos[i])
				else
					profile.set('photo' + (i+1), null)
			}
		}
		*/
	}

	response.success();
});

