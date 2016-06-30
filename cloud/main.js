"use strict";

// Remember the cloud code doesn't have the angular enhancement, so you will need to use the standard Parse API
// i.e. object.get('property') object.set('property', value)

var Profile = Parse.Object.extend("Profile");
var Match = Parse.Object.extend("Match");
var Report = Parse.Object.extend("Report");
var ChatMessage = Parse.Object.extend("ChatMessage");
var DeletedUser = Parse.Object.extend("DeletedUser");

var _ = require('underscore');

var config = require('./config.js');
require('./linkedin.js');
require('./migrations.js');
require('./jobs.js');
require('./app.js');
require('./admin.js');
require('./video.js');

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

/**
 * Process another users profile for security etc before returning it from a search or mutual match
 */
function _processProfile(profile) {

	var birthdate = profile.get('birthdate');
	if (birthdate) profile.set('age', _calculateAge(birthdate));

	// Comment out this line if you are in the process of migrating to the new data model
	profile.unset('birthdate');

	// http://stackoverflow.com/questions/25297590/saving-javascript-object-that-has-an-array-of-parse-files-causes-converting-cir
	var photos = profile.get('photos');
	photos = _.map(photos, function (file) {
		return { name: file.name, url: file.url(), __type: 'File' };
	});
	profile.set('photos', photos);

	// Remove other fields we don't need on the client
	profile.unset('notifyMatch');
	profile.unset('notifyMessage');
	profile.unset('ageFrom');
	profile.unset('ageTo');
	profile.unset('guys');
	profile.unset('girls');
	profile.unset('distance');
	profile.unset('distanceType');
	profile.unset('error');

	// See http://stackoverflow.com/questions/24959798/parse-com-cloud-function-manually-modify-object-fields-before-sending-to-clien
	profile.dirty = function () {
		return false;
	};

	return profile;
}

/**
 * @param {Date} birthday
 * @returns {number} age in years
 */
function _calculateAge(birthday) {
	if (!birthday) return 0; // avoid exception from dodgy data
	var ageDifMs = Date.now() - birthday.getTime();
	var ageDate = new Date(ageDifMs); // miliseconds from epoch
	return Math.abs(ageDate.getUTCFullYear() - 1970);
}

/**
 * Search for new potential matches
 * @returns IProfile[] the profiles
 */
Parse.Cloud.define("GetMatches", function (request, response) {
	// We need to use the master key to load the other users profiles
	Parse.Cloud.useMasterKey();

	var profile = request.params;
	console.log('profile: ' + JSON.stringify(profile));

	var profileQuery = new Parse.Query("Profile");

	var point = profile.location;
	if (profile.distanceType === 'km') profileQuery.withinKilometers("location", point, profile.distance);else profileQuery.withinMiles("location", point, profile.distance);

	var gender = [];
	if (profile.guys) gender.push('M');
	if (profile.girls) gender.push('F');
	profileQuery.containedIn("gender", gender);

	profileQuery.equalTo("enabled", true);

	// the birthdate from is the oldest of the age range
	var birthdateFrom = new Date();
	birthdateFrom.setFullYear(birthdateFrom.getFullYear() - profile.ageTo);
	var birthdateTo = new Date();
	birthdateTo.setFullYear(birthdateTo.getFullYear() - profile.ageFrom);
	profileQuery.lessThan("birthdate", birthdateTo);
	if (profile.ageTo !== MAX_AGE_PLUS) profileQuery.greaterThan("birthdate", birthdateFrom);

	// TODO this will be have to be re-worked at some point as there is a maximum limit of 1000 with Parse
	// The next two sub queries select the user id's we don't want to match on, which is from
	// the matches the user have already actioned (liked or rejected), or other users have rejected this user
	// This can be determined if the u1action/u2action property has already been set

	var alreadyMatched1Query = new Parse.Query("Match");
	alreadyMatched1Query.equalTo("uid1", Parse.User.current().id);
	alreadyMatched1Query.exists("u1action"); // where we have an action
	alreadyMatched1Query.select("uid2"); // then return the other user id
	alreadyMatched1Query.limit(1000);

	var alreadyMatched2Query = new Parse.Query("Match");
	alreadyMatched2Query.equalTo("uid2", Parse.User.current().id);
	alreadyMatched2Query.exists("u2action");
	alreadyMatched2Query.select("uid1");
	alreadyMatched2Query.limit(1000);

	//alreadyMatched1Query.find().then(function(result){
	//	console.log('alreadyMatched1Query ' + JSON.stringify(result))
	//})
	//alreadyMatched2Query.find().then(function(result){
	//	console.log('alreadyMatched2Query ' + JSON.stringify(result))
	//})

	var alreadyMatchedQuery = Parse.Query.or(alreadyMatched1Query, alreadyMatched2Query);
	alreadyMatchedQuery.limit(1000);

	return alreadyMatchedQuery.find().then(function (results) {
		//console.log('or query ' + JSON.stringify(results))
		var ids = [];
		var length = results.length;
		var userId = request.user.id;
		for (var i = 0; i < length; i++) {
			var row = results[i];
			//console.log(i + ': ' + JSON.stringify(row))
			var uid1 = row.get('uid1');
			if (uid1 != userId) ids.push(uid1);else ids.push(row.get('uid2'));
		}
		console.log('ids ' + JSON.stringify(ids));
		return ids;
	}).then(function (ids) {
		ids.push(Parse.User.current().id);
		profileQuery.notContainedIn('uid', ids);
		//profileQuery.notEqualTo("uid", Parse.User.current().id)
		profileQuery.descending("updatedAt");
		profileQuery.limit(25);
		return profileQuery.find();
	}).then(function (result) {
		console.log('search result: ' + JSON.stringify(result));
		result = _.map(result, _processProfile);
		response.success(result);
	}, function (error) {
		console.log(JSON.stringify(error));
		response.error(error);
	});

	//var alreadyMatchedQuery = Parse.Query.or(alreadyMatched1Query, alreadyMatched1Query);
	//profileQuery.doesNotMatchKeyInQuery("uid", "uid2", alreadyMatched1Query)
	//profileQuery.doesNotMatchKeyInQuery("uid", "uid1", alreadyMatched2Query)
	//
	//profileQuery.notEqualTo("uid", Parse.User.current().id)
	//profileQuery.descending("updatedAt")
	//profileQuery.limit(25)
	//
	//return profileQuery.find().then(function(result){
	//	response.success(result)
	//}, function(error) {
	//	response.error(error)
	//})
});

Parse.Cloud.define("ProcessMatch", function (request, response) {
	Parse.Cloud.useMasterKey();
	var userId = request.user.id;
	var otherUserId = request.params.otherUserId;
	var liked = request.params.liked;

	if (otherUserId == null) {
		response.error('otherUserId was not provided');
		return;
	}
	if (liked == null) {
		response.error('liked was not provided');
		return;
	}

	var match;
	var mutualMatch = false;
	var otherUser;
	// To have a consistent composite key for the match between the two users
	// we always have the lower key as user1 and the higher key as user2
	var isFirstId;
	var uid1, uid2;

	if (userId < otherUserId) {
		isFirstId = true;
		uid1 = userId;
		uid2 = otherUserId;
	} else {
		isFirstId = false;
		uid1 = otherUserId;
		uid2 = userId;
	}

	var matchQuery = new Parse.Query(Match);
	matchQuery.equalTo("uid1", uid1);
	matchQuery.equalTo("uid2", uid2);

	return matchQuery.first(function (result) {
		match = result;
		if (match == null) {
			// the user is the first to match of the pair
			console.log('first to swipe, creating the match object');
			match = new Match();
			match.set('uid1', uid1);
			match.set('uid2', uid2);

			var acl = new Parse.ACL();
			acl.setReadAccess(uid1, true);
			acl.setReadAccess(uid2, true);
			acl.setWriteAccess(uid1, true);
			acl.setWriteAccess(uid2, true);
			match.setACL(acl);

			// If we are the first to reject then put O for the other persons action ('Other reject')
			// This makes the query to get new potential matches easier by having it not empty
			if (!liked) match.set(isFirstId ? 'u2action' : 'u1action', 'O');
		}
		// set this users action
		match.set(isFirstId ? 'u1action' : 'u2action', liked ? 'L' : 'R');

		// set the current state of this match
		if (match.get('u1action') == null || match.get('u2action') == null) match.set('state', 'P'); // P for pending - this user was the first one to swipe
		else if (match.get('u1action') == 'R' || match.get('u2action') == 'R') match.set('state', 'R'); // R for rejected
			else if (match.get('u1action') == 'L' && match.get('u2action') == 'L') match.set('state', 'M'); // M for mutual like

		return match;
	}).then(function (result) {
		if (match.get('state') != 'M') return null;

		mutualMatch = true;
		// If it's a mutual match then save the pointer to the profiles on the match object
		//console.log('loading profiles for mutual match')
		var profileQuery = new Parse.Query(Profile);
		profileQuery.containedIn("uid", [uid1, uid2]);
		return profileQuery.find();
	}).then(function (profiles) {
		if (profiles != null) {
			// i.e. mutualMatch = true
			if (profiles.length != 2) {
				console.error('error - loading profiles for uids ' + uid1 + ' and ' + uid2 + ' returned ' + profiles.length + ' results');
			} else {
				if (profiles[0].get('uid') == uid1) {
					match.set('profile1', profiles[0]);
					match.set('profile2', profiles[1]);
				} else {
					match.set('profile1', profiles[1]);
					match.set('profile2', profiles[0]);
				}
			}
		}
		// now we can save the match object
		return match.save();
	}).then(function (match) {
		console.log('saved match ' + JSON.stringify(match));
		return mutualMatch ? new Parse.Query(Parse.User).get(otherUserId) : null;
	}).then(function (otherUser) {
		if (!mutualMatch || !otherUser) ;
		return null;

		// Add the match id to both users 'matches' property
		request.user.addUnique('matches', match.id);
		otherUser.addUnique('matches', match.id);
		Parse.Cloud.useMasterKey(); // might need this to save the other user
		return Parse.Object.saveAll([request.user, otherUser]);
	}).then(function (result) {
		if (!mutualMatch) {
			response.success();
			return;
		}

		// Send the push notification to the other user
		Parse.Push.send({
			channels: ["user_" + otherUserId],
			data: {
				alert: "You have a new match",
				badge: "Increment",
				sound: "cheering.caf",
				title: "New Match!",

				type: "match",
				matchId: match.id
			}
		}, {
			success: function success() {
				response.success(match);
			},
			error: function error(_error) {
				response.error(_error);
			}
		});
	}, function (error) {
		response.error(error);
	});
});

/**
 * Queries the Matches where other users like the current user, but this user hasn't swiped them, and returns the profile.
 * Useful for showing, or counting, which other users have liked this user (upto 1000 matches)
 * @returns IProfile[] the profiles
 */
Parse.Cloud.define('GetProfilesWhoLikeMe', function (request, response) {
	Parse.Cloud.useMasterKey();
	var userId = request.user.id;

	var maxResults = 20;

	function baseMatchQuery(thisId, otherId) {
		var matchQuery = new Parse.Query("Match");
		matchQuery.equalTo('state', 'P'); // pending the current user to swipe
		matchQuery.equalTo('u' + otherId + 'action', 'L'); // where the other user has liked us
		matchQuery.limit(maxResults);
		matchQuery.select('uid' + thisId);
		matchQuery.equalTo('uid' + thisId, request.user.id);
		matchQuery.descending('createdAt');
		return matchQuery;
	}

	var matchQuery = Parse.Query.or(baseMatchQuery('1', '2'), baseMatchQuery('2', '1'));
	matchQuery.limit(maxResults);
	matchQuery.find().then(function (matches) {
		console.log('found ' + matches.length + ' matches objects who like me');
		// The match objects are not a mutual match so they wont have the profile reference set
		// So load the User objects including the profile
		var userIds = [];
		_.each(matches, function (match) {
			var uid1 = match.get('uid1');
			var uid2 = match.get('uid2');

			userIds.push(userId === uid1 ? uid2 : uid1);
		});

		if (userIds.length === 0) return [];
		var userQuery = new Parse.Query(Parse.User);
		userQuery.include('profile');
		userQuery.containedIn('objectId', userIds);
		userQuery.limit(maxResults);
		return userQuery.find();
	}).then(function (users) {
		var profiles = [];
		_.each(users, function (user) {
			profiles.push(_processProfile(user.get('profile')));
		});
		return profiles;
	}).then(function (profiles) {
		response.success(profiles);
	}, function (error) {
		response.error(error);
	});
});

Parse.Cloud.define("RemoveMatch", function (request, response) {
	Parse.Cloud.useMasterKey();
	var matchId = request.params.matchId;
	var userId = request.user.id;
	var otherUserId;
	var otherUser;
	console.log('matchid ' + matchId);
	console.log('userid ' + userId);

	new Parse.Query(Match).get(matchId).then(function (match) {
		match.set('state', 'D'); // Deleted

		var uid1 = match.get('uid1');
		otherUser = new Parse.User();
		otherUser.id = uid1 === userId ? match.get('uid2') : uid1;
		otherUser.remove('matches', matchId);
		request.user.remove('matches', matchId);

		return Parse.Promise.when(match.save(), otherUser.save(), request.user.save(), notifyRemoveMatch(match, [otherUserId]));
	}).then(function () {
		response.success();
	}, function (error) {
		response.error(error);
	});
});

//
//Parse.Cloud.beforeSave('ChatMessage', function(request, response) {
//
//	// Validate the to/from uid's
//
//	var message = request.object
//	var query = new Parse.Query(Match)
//	query.get(message.get('match').id, {
//		success: function(match) {
//			var sendToUid
//			if(match.get('uid1') == message.get('sender'))
//				sendToUid = match.get('uid2')
//			else
//				sendToUid = match.get('uid1')
//		},
//		error: function(object, error) {
//			console.log('error loading match ' + error)
//		}
//	});
//})

/**
 * Set the sender and members properties, and check the message is allowed to be sent
 */
Parse.Cloud.beforeSave('ChatMessage', function (request, response) {
	// If re-saved from a migration job then don't resend push notifications
	if (request.master) {
		response.success();
		return;
	}

	var message = request.object;
	var userId = request.user.id;
	var matchId = message.get('match').id;

	message.set('sender', request.user.id);

	new Parse.Query(Match).get(matchId).then(function (match) {
		if (!match) {
			response.error('Match object does not exist');
			return;
		}

		var uid1 = match.get('uid1');
		var uid2 = match.get('uid2');
		if (uid1 !== userId && uid2 !== userId) {
			response.error('User is not a part of the provided match object');
			return;
		}

		if (match.get('state') !== 'M') {
			// Another check to ensure a malicious client can't message non-mutual matches
			response.error('Cant message to a non-mutual match');
			return;
		}

		var acl = new Parse.ACL();
		acl.setReadAccess(uid1, true);
		acl.setReadAccess(uid2, true);
		message.setACL(acl);

		message.set('userIds', [uid1, uid2]); // for a group chat you would want to add all the user ids in the chat
		response.success();
	}, function (error) {
		response.error(error);
	});
});

/**
 * This sends a push notification to all the members of the chat/match, except for the sender
 */
Parse.Cloud.afterSave('ChatMessage', function (request) {

	// If re-saved from a migration job then don't resend push notifications
	if (request.master) {
		return;
	}

	var message = request.object;
	var senderId = request.user.id; // which equals message.sender
	var match = message.get('match');
	var userIds = message.get('userIds');

	// create the channel list for all the members of the chat/match, except for the sender
	var channels = [];
	for (var i = 0; i < userIds.length; i++) {
		var id = userIds[i];
		if (id != senderId) channels.push('user_' + id);
	}

	var senderName = message.get('senderName');
	// for iOS the title will always be the app name
	// var title = 'New message!'
	var alert = senderName;
	if (message.get('text')) alert = senderName + ': ' + message.get('text');else if (message.get('image')) alert = senderName + ' sent an image';else if (message.get('audio')) alert = senderName + ' sent an audio message';

	Parse.Push.send({
		channels: channels,
		data: {
			alert: alert,
			badge: "Increment",
			sound: "cheering.caf",
			// title: title,

			type: "message",
			message: {
				id: message.id,
				match: { id: match.id },
				text: message.get('text'),
				sender: request.user.id,
				createdAt: message.createdAt.getTime()
			}
		}
	});
});

Parse.Cloud.beforeSave('ContactMessage', function (request, response) {
	request.object.set('user', request.user);
	request.object.setACL(new Parse.ACL());
	response.success();
});

Parse.Cloud.afterSave("ContactMessage", function (request) {
	var user = request.user;
	var message = 'New contact message from user ' + user.id + '\n\n' + request.object.get('message');

	Email.sendAdminEmail('Contact Message', message).then(function (result) {}, function (error) {
		console.error('Error sending contact message email: ' + error);
	});
});

/**
 * We don't normally delete matches, just mark them as deleted
 * But if we do delete one through the admin dashboad then do the appropriate cleanup
 */
Parse.Cloud.afterDelete("Match", function (request) {
	Parse.Cloud.useMasterKey();
	var match = request.object;

	if (match.get('state') === 'M') {
		var query = new Parse.Query(Parse.User);
		query.containedIn('objectId', [match.get('uid1'), match.get('uid2')]);
		query.find().then(function (users) {
			_.each(users, function (user) {
				user.remove('matches', match.id);
			});
			Parse.Object.saveAll(users);
		});
		notifyRemoveMatch(match, [match.get('uid1'), match.get('uid2')]);
	}

	var query = new Parse.Query("ChatMessage");

	query.equalTo("match", match);
	query.find().then(function (messages) {
		return Parse.Object.destroyAll(messages, { useMasterKey: true });
	}).then(function (success) {
		// The related comments were deleted
	}, function (error) {
		console.error("Error deleting messages for match " + request.object.id + "  code:" + error.code + ": " + error.message);
	});
});

Parse.Cloud.define('DeleteUnmatched', function (request, response) {
	Parse.Cloud.useMasterKey();
	var user = request.user;
	var userId = user.id;

	var matches1Query = new Parse.Query("Match");
	matches1Query.equalTo("uid1", userId);
	matches1Query.containedIn('state', ['P', 'R']);
	matches1Query.limit(1000);

	var matches2Query = new Parse.Query("Match");
	matches2Query.equalTo("uid2", userId);
	matches2Query.containedIn('state', ['P', 'R']);
	matches2Query.limit(1000);

	var count = 0;
	Parse.Query.or(matches1Query, matches2Query).limit(1000).find().then(function (matches) {
		count = matches.length;
		return Parse.Object.destroyAll(matches);
	}).then(function (success) {
		response.success('found ' + count + ' rejected matches to delete');
	}, function (error) {
		response.error(error);
	});
});

/** Delete the current user account */
Parse.Cloud.define('DeleteAccount', function (request, response) {
	Parse.Cloud.useMasterKey();
	deleteUser(response, request.user);
});

/** Delete the account for a particular user. Admin only function */
Parse.Cloud.define('DeleteUser', function (request, response) {
	Parse.Cloud.useMasterKey();
	var user = request.user;
	if (!user.admin) return response.error('Must be an admin to delete a user');
	var userId = user.params.userId;
	if (!userId) return response.error('userId parameter must be provided');
	new Parse.Query(Parse.User).get(userId).then(function (user) {
		deleteUser(response, user);
	}, function (error) {
		response.error(error);
	});
});

function deleteUser(response, user) {
	var userId = user.id;
	// TODO could update the client to accept a user id in a removeMatch notification, then could have one push API call
	//var mutualMatchChannels = []

	var deletedUser = new DeletedUser();

	function sendRemoveMatchPushNotification(matchId, otherUserId) {
		Parse.Push.send({
			channels: ['user_' + otherUserId],
			data: {
				type: "removeMatch",
				matchId: matchId
			}
		}, {
			success: function success() {},
			error: function error(_error2) {
				console.error('Error sending push notification for unmatching a deleted account. ' + JSON.stringify(_error2));
			}
		});
	}

	user.set('status', 'deleting');
	return user.save().then(function (success) {

		var profile = user.get('profile');
		// TODO should delete photo files
		if (profile) {
			profile.fetch().then(function (profile) {
				try {
					deletedUser.set('profile', JSON.stringify(profile));
				} catch (e) {
					console.error('couldnt stringify profile of deleted user');
				}
				profile.destroy();
			}, function (error) {
				// don't return an error if the profile doesnt exist in the database
			});
		}
		return null;
	}).then(function (success) {
		console.log('deleted profile');
		// Find the user's mutual match objects
		var match1Query = new Parse.Query(Match);
		match1Query.equalTo('uid1', userId);
		match1Query.equalTo('state', 'M');

		var match2Query = new Parse.Query(Match);
		match2Query.equalTo('uid2', userId);
		match2Query.equalTo('state', 'M');

		return Parse.Query.or(match1Query, match2Query).each(function (match) {

			match.set('state', 'D'); // set state to deleted

			var uid1 = match.get('uid1');
			var otherUserId = userId == uid1 ? match.get('uid2') : uid1;

			//  Set the state to deleted and remove the users id from the other User.matches
			var otherUser = new Parse.User();
			otherUser.id = otherUserId;
			otherUser.remove('matches', match.id);

			sendRemoveMatchPushNotification(match.id, otherUserId);
			return Parse.Promise.when(match.save(), otherUser.save());
		});
	}).then(function (success) {
		console.log('updated all matches and users');
		// store the user and profile in the DeleteUser table
		try {
			deletedUser.set('user', JSON.stringify(user));
		} catch (e) {
			console.error('couldnt stringify user of deleted user');
		}
		deletedUser.set('uid', userId);
		console.log('creating deleted user and destroying user...');
		return Parse.Promise.when(deletedUser.save(), user.destroy());
	}).then(function (success) {
		response.success();
	}, function (error) {
		response.error(error);
	});
}

/**
 * Convenience function to clear the database, e.g. before running integration tests.
 * To protect against accidentally running it on valuable data it checks for the integrationAppId
 * defined in config.js
 */
Parse.Cloud.define("DeleteAllData", function (request, response) {

	if (Parse.applicationId !== config.integrationAppId) {
		response.error('Cannot delete data. Application Id does not match integration app Id');
		return;
	}
	Parse.Cloud.useMasterKey();

	return new Parse.Query(Profile).limit(1000).find(function (profiles) {
		return Parse.Object.destroyAll(profiles);
	}).then(function () {
		return new Parse.Query(Match).limit(1000).find();
	}).then(function (matches) {
		return Parse.Object.destroyAll(matches);
	}).then(function () {
		return new Parse.Query(ChatMessage).limit(1000).find();
	}).then(function (messages) {
		return Parse.Object.destroyAll(messages);
	}).then(function () {
		return new Parse.Query(Report).limit(1000).find();
	}).then(function (reports) {
		return Parse.Object.destroyAll(reports);
	}).then(function () {
		return new Parse.Query(Parse.User).limit(1000).find();
	}).then(function (users) {
		return Parse.Object.destroyAll(users);
	}).then(function () {
		response.success('Database truncated');
	}, function (error) {
		response.error(error);
	});
});

/**
 * Send the remove match push notification for the given match to the users
 * @param match
 * @param uids array of user ids
 * @returns {Promise<T>}
 */
function notifyRemoveMatch(match, uids) {
	var channels = _.map(uids, function (uid) {
		return 'user_' + uid;
	});
	return Parse.Push.send({
		channels: channels,
		data: {
			type: 'removeMatch',
			matchId: match.id
		}
	});
}

//var adminQuery = new Parse.Query(Parse.User)
//adminQuery.equalTo('admin',true)
//adminQuery.find().then(function(users) {
//	consolel.log('found ' + users.length + ' admin users')
//})