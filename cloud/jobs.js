var _ = require('underscore');

var Profile = Parse.Object.extend("Profile")
var Match = Parse.Object.extend("Match")
var ChatMessage = Parse.Object.extend("ChatMessage")

/**
 * Useful for getting the most recent full day for daily reporting etc
 * Contains the first second of the next day, so should be used as ( >= from && < to )
 * @returns {Object} range
 */
function getYesterdayDateRange() {
	var range = {}
	var now = new Date()
	range.from = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0 ,0)
	range.to = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0 ,0)
	console.log(range.from)
	console.log(range.to)
	return range
}



/**
 * Load up the recent matches from all of yesterday and send a push notifications to each user that has at least one new like.
 * A job schedule needs to be created for this that should run daily early in the day.
 */
Parse.Cloud.job("New_Like_Notifications", function(request, status) {
	Parse.Cloud.useMasterKey()

	var likedUserIds = {}
	var channels
	var yesterdayRange = getYesterdayDateRange()

	var matchQuery = new Parse.Query(Match)

	matchQuery.equalTo('state', 'P') // filter only in Pending state, i.e. where just one user has liked
	matchQuery.greaterThanOrEqualTo('createdAt', yesterdayRange.from)
	matchQuery.lessThan('createdAt', yesterdayRange.to)

	matchQuery.each(function(match) {

		if(match.get('action1'))
			likedUserIds[match.get('uid2')] = null
		else
			likedUserIds[match.get('uid1')] = null

	}).then(function(result) {

		channels = _.keys(likedUserIds)
		// pre-pend 'user_' to each value in the array
		channels = _.map(channels, function(e) { return 'user_' + e })

		// Parse lets you send at a time the users local timezone.  Send the notifications at 8pm for better engagement
		// This job should be scheduled to complete before 8pm each day
		var pushTime = new Date()
		pushTime.setHours(20, 0)

		return Parse.Push.send({
			channels: channels,
			push_time: pushTime,
			data: {
				alert: "You have a new likes!",
				badge: "Increment",
				sound: "cheering.caf",
				title: "New Likes!",
				type: "newLikes"
			}
		})
	}).then(function(result) {
		status.success('Notified ' + channels.length + ' users of a new like')
	}, function(error) {
		status.error('Job error ' + JSON.stringify(error))
	})

})


Parse.Cloud.define('RebuildMatches', function(request, response) {
	Parse.Cloud.useMasterKey()
	rebuildMatches(request.user).then(function() {
		response.success()
	}, function() {
		response.error()
	})
})

Parse.Cloud.job('RebuildMatches', function(request, response) {
	Parse.Cloud.useMasterKey()
	new Parse.Query(Parse.User).each(rebuildMatches).then(function() {
		response.success()
	}, function() {
		response.error()
	})
})


function rebuildMatches(user) {
	var query1 = new Parse.Query('Match')
		.equalTo('uid1', user.id)
		.equalTo('state', 'M')
		.limit(1000)
	var query2 = new Parse.Query('Match')
		.equalTo('uid2', user.id)
		.equalTo('state', 'M')
		.limit(1000)

	return Parse.Query.or(query2, query1).limit(1000).select('objectId').find().then(function(result) {
		var matches = []
		_.each(result, function(match) {matches.push(match.id)})

		if(!user.get('matches') || arraysEqual(user.get('matches'), matches)) {
			return
		}
		console.log(JSON.stringify(user.get('matches')) + '   ' + JSON.stringify(matches))
		console.log('Updating matches for ' + user.id + '. Length ' + user.get('matches').length + ' -> ' + matches.length)

		user.set('matches', matches)
		return user.save()
	})
}

function arraysEqual(a, b) {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (a.length != b.length) return false;

	// If you don't care about the order of the elements inside
	// the array, you should sort both arrays here.
	a.sort()
	b.sort()

	for (var i = 0; i < a.length; ++i) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}



Parse.Cloud.job("Fix_Mutual_Matches_Missing_Profiles", function(request, status) {
	Parse.Cloud.useMasterKey()
	var matchQuery = new Parse.Query(Match)

	matchQuery.limit(1000)
	matchQuery.equalTo('state', 'M')
	matchQuery.doesNotExist('profile1')

	var promises = []
	matchQuery.find().then(function(matches) {
		console.log('found ' + matches.length + ' mutual matches to fix')
		_.each(matches, function(match) {
			promises.push(fixMutualMatch(match))
		})

		Parse.Promise.when(promises).then(function(result) {
			status.success('job complete')
		}, function(error) {
			status.error('job error ' + JSON.stringify(error))
		})
	}, function(error) {
		status.error('job error ' + JSON.stringify(error))
	})

	var fixMutualMatch = function(match) {
		var user1, user2

		return new Parse.Query(Parse.User).get(match.get('uid1')).then(function(result) {
			user1 = result
			return new Parse.Query(Parse.User).get(match.get('uid2'))
		}).then(function(result) {
			user2 = result
			match.set('profile1', user1.get('profile'))
			match.set('profile2', user2.get('profile'))
			return match.save()
		})
	}
});

Parse.Cloud.job("Fix_Duplicate_Profiles", function(request, status) {
	Parse.Cloud.useMasterKey()

	var profileQuery = new Parse.Query(Profile)
	profileQuery.descending('createdAt')

	profileQuery.limit(1000)
	profileQuery.find().then(function(profiles) {
		console.log(profiles.length + ' profiles')

		// group the profiles by uid
		var byUid = _.groupBy(profiles, function(p){return p.get('uid')})

		console.log(_.keys(byUid).length + ' by uid')

		// filter where there is more than one profile with the same uid
		var dupes = _.filter(byUid, function(val) { return val.length > 1 })

		console.log(dupes.length + ' duplicates')

		var promises = []
		var i, dupe
		for(i=0; i<dupes.length; i++) {
			dupe = dupes[i]
			dupe = _.sortBy(dupe, 'createdAt')
			promises.push(fixDupes(dupe[0], dupe.slice(1, dupe.length)))
		}
		return Parse.Promise.when(promises)
	}).then(function(result) {
		status.success('job complete')
	}, function(error) {
		status.error('job error ' + JSON.stringify(error))
	})

	var fixDupes = function(orig, dupes) {
		console.log('updating profile id to ' + orig.id)
		var user
		var userQuery = new Parse.Query(Parse.User)
		return userQuery.get(orig.get('uid')).then(function(result) {
			user = result
			console.log('updating user ' + user.id)
			return user.save({'profile': orig})
		}).then(function(user) {
			// find the mutual matches which have a duplicate profile
			var matches1 = new Parse.Query(Match)
			matches1.containedIn('profile1', dupes)
			var matches2 = new Parse.Query(Match)
			matches2.containedIn('profile2', dupes)
			return Parse.Query.or(matches1, matches2).find()
		}).then(function(matches) {
			console.log('found ' + matches.length + ' matches')
			// update the mutual matches with the original profile
			var updated = []
			_.each(matches, function(match) {
				if(match.get('uid1') == user.id) {
					match.set('profile1', orig)
					console.log('updated profile1 for match ' + match.id)
					updated.push(match)
				} else if(match.get('uid2') == user.id) {
					match.set('profile2', orig)
					console.log('updated profile2 for match ' + match.id)
					updated.push(match)
				}
			})
			return Parse.Object.saveAll(updated)

		}).then(function(matches) {
			console.log('deleting duplicate profiles')
			return Parse.Object.destroyAll(dupes)
		})
	}
})



Parse.Cloud.job("Log_Duplicate_Profiles", function(request, status) {
	Parse.Cloud.useMasterKey()

	var profileQuery = new Parse.Query(Profile)
	profileQuery.descending('createdAt')

	profileQuery.limit(1000)
	profileQuery.find().then(function(profiles) {
		console.log(profiles.length + ' profiles')

		// group the profiles by uid
		var byUid = _.groupBy(profiles, function(p){return p.get('uid')})

		console.log(_.keys(byUid).length + ' by uid')

		// filter where there is more than one profile with the same uid
		var dupes = _.filter(byUid, function(val) { return val.length > 1 })

		console.log(dupes.length + ' users with duplicate profiles')

		// extract the fields we're interested in
		var mapper = function(p){ return {id:p.id, uid:p.uid, createdAt:p.createdAt, updatedAt:p.updatedAt} }

		var i, dupe, orig
		for(i=0; i<dupes.length; i++) {
			dupe = dupes[i]
			dupe = _.sortBy(dupe, 'createdAt')
			orig = dupe[0]
			console.log('orig  ' + JSON.stringify(_.map([orig], mapper)))
			console.log('dupes ' + JSON.stringify(_.map(dupe.slice(1, dupe.length), mapper)))
			console.log('')
		}
		status.success('job complete')
	}, function(error) {
		status.error('job error ' + JSON.stringify(error))
	})
})