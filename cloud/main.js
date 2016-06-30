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

Parse.Cloud.beforeSave(Parse.User, function (request, response) {
	var user = request.object;

	if (user.id == null) {
		user.set('admin', false);
		user.set('premium', false);
		user.set('credits', 0);
		user.set('matches', []);

		var acl = new Parse.ACL();
		acl.setPublicReadAccess(false);
		acl.setPublicWriteAccess(false);
		user.setACL(acl);
	} else if (!request.master) {
		if (user.dirty('admin')) return response.error('You cant set the admin flag');
		if (user.dirty('premium')) return response.error('You cant set the premium flag');
		if (user.dirty('credits')) return response.error('You cant set the credits');
	}

	// Extract the facebook user id to its own column, if it has changed
	var fbId = user.get('fbId');
	var fbAuth = user.get('authData');
	if (fbAuth && fbAuth.facebook && fbId !== fbAuth.facebook.id) user.set('fbId', fbAuth.facebook.id);

	response.success();
});

// Note that the saving of the profile to the user happens after the
// user object is returned, so it would need to be refreshed by the client
// to see the profile link when first saved
Parse.Cloud.afterSave(Parse.User, function (request) {
	var user = request.object;

	var profile = user.get('profile');

	// When creating a new User link the profile object
	if (!profile) {
		profile = new Profile();
		profile.set('uid', user.id); // Need to set this here for Profile.beforeSave
		Parse.Cloud.useMasterKey();
		return profile.save().then(function (profile) {
			user.set('profile', profile);
			return user.save().then(function () {}, function (error) {
				console.error('error saving profile ' + profile.id + ' to user ' + user.id + ' ' + JSON.stringify(error));
			});
		}, function (error) {
			console.error('Error creating profile for user ' + user.id + ' ' + JSON.stringify(error));
		});
	}
});

Parse.Cloud.define('PostLogin', function (request, response) {
	// return 'UPDATE_REQUIRED' when you have switched over to the self-hosted parse server
	response.success("");
});

Parse.Cloud.beforeSave(Profile, function (request, response) {
	var profile = request.object;
	var userId;

	// If we have strict controls on certain fields then don't let a custom client update them
	if (!request.master) {
		if (RESTRICT_BIRTHDATE && profile.dirty('birthdate')) {
			response.error('Cannot update birthdate');
			return;
		}
		if (RESTRICT_NAME && profile.dirty('name')) {
			response.error('Cannot update name');
			return;
		}
		if (RESTRICT_GENDER && profile.dirty('gender')) {
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

	if (!profile.id) {
		// Creating a new Profile object
		// request.user can be null (either from a brand new user or using master key)
		userId = request.user ? request.user.id : profile.get('uid');
		if (!userId) {
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
	} else {
		// Saving an existing Profile

		if (profile.dirty('birthdate')) {
			var birthdate = profile.get('birthdate'),
			    ageFrom = profile.get('ageFrom'),
			    ageTo = profile.get('ageTo');
			if (birthdate) {
				var age = _calculateAge(birthdate);
				if (!ageFrom) {
					ageFrom = age - 5;
					if (ageFrom < 18) ageFrom = 18;
					profile.set('ageFrom', ageFrom);
				}
				if (!ageTo) {
					ageTo = age + 5;
					if (ageTo > 55) ageTo = 55;
					profile.set('ageTo', ageTo);
				}
			}
		}
		if (profile.dirty('gender')) {
			var gender = profile.get('gender');
			if (!profile.has('guys')) profile.set('guys', gender !== 'M');
			if (!profile.has('girls')) profile.set('girls', gender !== 'F');
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

Parse.Cloud.define('SetPremium', function (request, response) {

	// Use the master key to update the restricted premium property
	Parse.Cloud.useMasterKey();
	var premium = request.params.premium;
	var product = request.params.product;

	if (_.isUndefined(premium)) return response.error('Parameter "premium" was not provided');
	if (premium && _.isUndefined(product)) return response.error('Parameter "product" must be provided if settings premium to true');

	// TODO server-side verification
	// Use http://reeceipt.fovea.cc/ when its ready or make https://github.com/voltrue2/in-app-purchase Parse friendly

	var user = request.user;
	user.set('premium', premium);
	user.save().then(function () {
		response.success();
	}, function (error) {
		response.error(error);
	});
});

Parse.Cloud.define("CopyFacebookProfile", function (request, response) {
	// Use the master key to update the potentially restricted properties
	Parse.Cloud.useMasterKey();
	var user = request.user;
	var profileUpdates = { photos: [] };
	var profile;

	if (Parse.FacebookUtils.isLinked(user)) {

		var fbAuth = user.get('authData').facebook;

		var picUrl = "https://graph.facebook.com/" + fbAuth.id + "/picture?width=500&height=500";
		var imageRequest = Parse.Cloud.httpRequest({
			url: picUrl,
			followRedirects: true
		});

		var profile = user.get('profile');
		if (!profile) {
			response.error('User does not have a profile');
			return;
		}
		var profileRequest = new Parse.Query(Profile).get(profile.id);

		var fbLikesRequest = Parse.Cloud.httpRequest({ url: 'https://graph.facebook.com/me/likes?limit=999&access_token=' + fbAuth.access_token });
		var fbMeRequest = Parse.Cloud.httpRequest({ url: 'https://graph.facebook.com/me?fields=birthday,first_name,last_name,name,gender,email,hometown&access_token=' + fbAuth.access_token });

		Parse.Promise.when(fbLikesRequest, fbMeRequest).then(function (fbLikesResponse, fbMeResponse) {

			var fbLikesData = fbLikesResponse.data.data;
			var fbMe = fbMeResponse.data;
			console.log(JSON.stringify(fbMe));
			var i;
			var fbLikes = [];

			for (i = 0; i < fbLikesData.length; i++) {
				fbLikes.push(fbLikesData[i].id);
			}profileUpdates.fbLikes = fbLikes;

			var errorCode = _copyFacebookProfile(fbMe, profileUpdates);
			if (errorCode) {
				return Parse.Promise.error({ code: errorCode });
			}

			if (fbMe.email) {
				// Save this asynchronously
				// TODO log any errors - should be an error if email exists
				if (!user.getEmail()) user.save({ 'email': fbMe.email });else user.save({ 'fbEmail': fbMe.email });
			}

			// Wait for the profile image request to return
			return imageRequest;
		}).then(function (httpResponse) {
			console.log('httpResponse ' + httpResponse);
			var file = new Parse.File("profile.png", { base64: httpResponse.buffer.toString('base64', 0, httpResponse.buffer.length) });
			return file.save();
		}).then(function (file) {
			// See http://stackoverflow.com/questions/25297590/saving-javascript-object-that-has-an-array-of-parse-files-causes-converting-cir
			profileUpdates.photos.push({ name: file.name, url: file.url(), __type: 'File' });

			return profileRequest;
		}).then(function (result) {
			profile = result;
			return profile.save(profileUpdates);
		}).then(function (profile) {
			response.success(profile);
		}, function (error) {
			console.error('Facebook copy error' + JSON.stringify(error));
			if (profile) {
				// Try to save the error onto the profile. Ignore success/error
				var errorMsg = error.code ? error.code : error;
				profile.save({ error: errorMsg });
			}
			if (error.code) response.error(error);else response.error({ code: 'FB_PROFILE_COPY_FAILED', message: 'Error getting Facebook profile', source: error });
		});
	} else {
		response.error('Account is not linked to Facebook');
	}
});

/**
 *
 * @param fbMe the response from the facebook graph query
 * @param profileUpdates {IProfile} the change set to update the Profile with
 * @return an error code, or null if ok
 * @private
 */
function _copyFacebookProfile(fbMe, profileUpdates) {
	var year, month, day;

	// Validate the Facebook profile data
	if (!fbMe.first_name && RESTRICT_NAME) {
		return 'NO_FB_NAME';
	}
	if (!fbMe.gender && RESTRICT_GENDER) {
		return 'NO_FB_GENDER';
	}
	// A full birthday is in the format MM/DD/YYYY
	// Restricted permissions may return only YYYY or MM/DD
	if (RESTRICT_BIRTHDATE && !fbMe.birthday) {
		return 'NO_FB_BIRTHDAY';
	} else if (RESTRICT_BIRTHDATE && fbMe.birthday.length !== 10) {
		return 'NO_FB_FULL_BIRTHDAY';
	}

	profileUpdates.name = fbMe.first_name;
	if (fbMe.gender === 'male') profileUpdates.gender = 'M';else if (fbMe.gender === 'female') profileUpdates.gender = 'F';else profileUpdates.gender = fbMe.gender;

	if (fbMe.birthday && fbMe.birthday.length === 10) {
		year = parseInt(fbMe.birthday.substring(6, 10), 10);
		month = parseInt(fbMe.birthday.substring(0, 2), 10) - 1;
		day = parseInt(fbMe.birthday.substring(3, 5), 10);
		profileUpdates.birthdate = new Date(year, month, day);
	} else if (fbMe.birthday) {
		// if !REQUIRE_FB_BIRTHDAY then store the partial birthday to pre-fill a birthdate selection
		profileUpdates.fbBirthday = fbMe.birthday;
	}

	// The user_hometown permission must be requested in the Facebook application settings, and in the facebook login
	// code in controller-signin for this to be populated
	if (fbMe.hometown) {
		profileUpdates.hometown = fbMe.hometown.name;
	}

	// Check for the minimum age requirement
	if (MINIMUM_AGE && profileUpdates.birthdate && _calculateAge(profileUpdates.birthdate) < MINIMUM_AGE) return 'MINIMUM_AGE_ERROR';

	return null; // success
}

/**
 * A function to reload the profile for a mutual match
 */
Parse.Cloud.define("GetProfileForMatch", function (request, response) {
	var user = request.user;
	var matchId = request.params.matchId;
	Parse.Cloud.useMasterKey();

	if (!matchId) {
		response.error('matchId param not provided');
		return;
	}

	// Check the requested profile is a mutual match before returning it
	if (user.get('matches').indexOf(matchId) < 0) {
		response.error('Match id:' + matchId + ' is not a mutual match for user ' + user.id);
		return;
	}

	var matchQuery = new Parse.Query(Match);
	matchQuery.include('profile1');
	matchQuery.include('profile2');

	matchQuery.get(matchId).then(function (match) {
		if (!match) throw 'Match does not exist with id ' + match;

		if (match.get('state') !== 'M') throw 'Match ' + matchId + ' is not a mutual match';

		// Get the other profile
		var profile;
		if (match.get('uid1') === user.id) profile = match.get('profile2');else if (match.get('uid2') === user.id) profile = match.get('profile1');else response.error('User does not belong to match ' + match.id);

		response.success(_processProfile(profile));
	}).then(null, function (error) {
		response.error(error);
	});
});

/**
 * Load an array of mutual matches, with their profile, given an array of match ids
 */
Parse.Cloud.define("GetMutualMatches", function (request, response) {
	var user = request.user;
	var matchIds = request.params.matchIds;
	// We need to use the master key to load the other users profile, so we will need to check uid1 and uid2 are valid
	Parse.Cloud.useMasterKey();

	if (!matchIds) {
		response.error('matchIds param not provided');
		return;
	}

	var matchesQuery = new Parse.Query(Match);
	matchesQuery.include('profile1');
	matchesQuery.include('profile2');
	matchesQuery.equalTo('state', 'M');
	matchesQuery.limit(1000);
	matchesQuery.containedIn('objectId', matchIds);

	matchesQuery.find().then(function (matches) {
		var result = [];
		var profile1, profile2;

		_.each(matches, function (match) {
			// Clear the current users profile, no need to return that over the network, and clean the Profile
			if (match.get('uid1') === user.id) {
				profile2 = match.get('profile2');
				if (!profile2) return;
				match.set('profile2', _processProfile(profile2));
				match.unset('profile1');
			} else if (match.get('uid2') === user.id) {
				profile1 = match.get('profile1');
				if (!profile1) return;
				match.set('profile1', _processProfile(profile1));
				match.unset('profile2');
			} else {
				console.error('Attempted to load match ' + match.id + ' which did not belong to user ' + user.id);
				return;
			}

			// See http://stackoverflow.com/questions/24959798/parse-com-cloud-function-manually-modify-object-fields-before-sending-to-clien
			match.dirty = function () {
				return false;
			};

			result.push(match);
		});
		response.success(result);
	}).then(null, function (error) {
		response.error(error);
	});
});

///**
// * Load a mutual match and its profile. e.g. when get a match push notification
// */
//Parse.Cloud.define("GetMutualMatch", function(request, response) {
//	var user = request.user
//	var matchId = request.params.matchId
//	// We need to use the master key to load the other users profile, so we need to check uid1 and uid2
//	Parse.Cloud.useMasterKey()
//	if(!matchId) {
//		response.error('matchId param not provided')
//		return
//	}
//
//	var matchQuery = new Parse.Query(Match)
//	matchQuery.include('profile1')
//	matchQuery.include('profile2')
//
//	matchQuery.get(matchId).then(function(match) {
//		if(!match)
//			throw 'Match does not exist with id ' + match
//
//		if(match.get('state') !== 'M')
//			throw 'Match ' + matchId + ' is not a mutual match'
//
//		// Clear the current users profile, no need to return that over the network
//		if(match.get('uid1') === user.id)
//			match.unset('profile1')
//		else if(match.get('uid2') === user.id)
//			match.set('profile2', null)
//		else {
//			response.error('Invalid match, not for this user')
//			return
//		}
//		// TODO convert profile birthdate to age
//
//		response.success(match)
//
//	}).then(null, function(error) {
//		response.error(error)
//	})
//})
