

function processMutualMatch(matchParams){

	Parse.Cloud.useMasterKey()
	var userId = request.user.id
	var otherUserId = request.params.otherUserId
	var liked = request.params.liked

	if(otherUserId == null) {
		response.error('otherUserId was not provided')
		return
	}
	if(liked == null) {
		response.error('liked was not provided')
		return
	}

	var match
	var mutualMatch = false
	var otherUser

	var currentUser


	if(otherUserId == null) {
		console.log('otherUserId was not provided')
		return
	}
	if(liked == null) {
		console.log('liked was not provided')
		return
	}

	var match
	var mutualMatch = false
	var otherUser
	var matchId
	// To have a consistent composite key for the match between the two users
	// we always have the lower key as user1 and the higher key as user2
	var isFirstId
	var uid1, uid2

	if(userId < otherUserId) {
		isFirstId = true
		uid1 = userId
		uid2 = otherUserId
	} else {
		isFirstId = false
		uid1 = otherUserId
		uid2 = userId
	}

	var matchQuery = new Parse.Query(Match)
	matchQuery.equalTo("uid1", uid1)
	matchQuery.equalTo("uid2", uid2)

	return matchQuery.first(function(result) {
		match = result
		if (match == null) {
			// the user is the first to match of the pair
			console.log('first to swipe, creating the match object')
			match = new Match()
			match.set('uid1', uid1)
			match.set('uid2', uid2)

			var acl = new Parse.ACL()
			acl.setReadAccess(uid1, true)
			acl.setReadAccess(uid2, true)
			acl.setWriteAccess(uid1, true)
			acl.setWriteAccess(uid2, true)
			match.setACL(acl)

			// If we are the first to reject then put O for the other persons action ('Other reject')
			// This makes the query to get new potential matches easier by having it not empty
			if(!liked)
				match.set(isFirstId ? 'u2action' : 'u1action', 'O')
		}

		else {

			mutualMatch = true
		}
		// set this users action
		match.set(isFirstId ? 'u1action' : 'u2action', liked ? 'L' : 'R')
		// set the current state of this match
		if (match.get('u1action') == null || match.get('u2action') == null)
			match.set('state', 'P') // P for pending - this user was the first one to swipe
		else if (match.get('u1action') == 'R' || match.get('u2action') == 'R')
			match.set('state', 'R') // R for rejected
		else if (match.get('u1action') == 'L' && match.get('u2action') == 'L')
			match.set('state', 'M') // M for mutual like

		match.set('state', 'M') // M for mutual like
		// If it's a mutual match then save the pointer to the profiles on the match object
		//console.log('loading profiles for mutual match')
		var profileQuery = new Parse.Query(Profile)
		profileQuery.containedIn("uid", [uid1, uid2])
		return profileQuery.find()
			.then(function(profiles){
				if(profiles != null) { // i.e. mutualMatch = true
					if(profiles.length != 2) {
						console.error('error - loading profiles for uids ' + uid1 + ' and ' + uid2 + ' returned ' + profiles.length + ' results')
					} else {
						if(profiles[0].get('uid') == uid1) {
							match.set('profile1', profiles[0])
							match.set('profile2', profiles[1])
						} else {
							match.set('profile1', profiles[1])
							match.set('profile2', profiles[0])
						}
					}
				}
				// now we can save the match object
				return match.save()

			}).then(function(match) {
				console.log('saved match ' + JSON.stringify(match))
				console.log("other user id"+otherUserId)
				return new Parse.Query(Parse.User).get(otherUserId)


			}).then(function(otherUser) {

				// Add the match id to both users 'matches' property
				//request.user.addUnique('matches', match.id)
				if(!mutualMatch || !otherUser)
					return null

				// Add the match id to both users 'matches' property
				request.user.addUnique('matches', match.id)
				otherUser.addUnique('matches', match.id)
				Parse.Cloud.useMasterKey() // might need this to save the other user
				return Parse.Object.saveAll([request.user, otherUser])


			}).then(function(){
				if(!mutualMatch) {
					response.success()
					return
				}
			},function(error){
				response.error(JSON.stringify(error))
			});

	})