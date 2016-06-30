var _ = require('underscore');

var Profile = Parse.Object.extend("Profile")
var Match = Parse.Object.extend("Match")
var ChatMessage = Parse.Object.extend("ChatMessage")


Parse.Cloud.job("Migrate_003_Profile_Photos", function(request, status) {
	Parse.Cloud.useMasterKey()

	var profileQuery = new Parse.Query(Profile)
	profileQuery.limit(200)
	profileQuery.doesNotExist('photos')

	profileQuery.find().then(function(profiles) {
		_.each(profiles, function(profile) {
			var photos = []
			var p
			p = profile.get('photo1')
			if(p)
				photos.push(p)
			p = profile.get('photo2')
			if(p)
				photos.push(p)
			p = profile.get('photo3')
			if(p)
				photos.push(p)
			profile.set('photos', photos)
		})
		Parse.Object.saveAll(profiles).then(
			function(){ status.success('complete') },
			function(error) { status.error('error migrating profile photos ' + JSON.stringify(error))})
	})
})


Parse.Cloud.job("Migrate_002_Disable_Public_Read_to_Users", function(request, status) {
	Parse.Cloud.useMasterKey()

	var userQuery = new Parse.Query(Parse.User);
	userQuery.ascending('createdAt');
	userQuery.limit(1000);

	return userQuery.find().then(function(users) {
		if(users.length == 1000)
			console.log('Reached maximum query limit of 1000 users')

		var acl
		var toSave = []
		_.each(users, function(user) {
			acl = user.getACL()
			if(!acl) {
				user.setACL(new Parse.ACL(user))
				toSave.push(user)
			}
			else if(acl.getPublicReadAccess() === true) {
				user.getACL().setPublicReadAccess(false)
				toSave.push(user)
			}
		})
		console.log('saving ' + toSave + ' users with private ACL')
		return Parse.Object.saveAll(toSave)
	}).then(function() {
		status.success('complete')
	}, function(error) {
		status.error(JSON.stringify(error))
	})
})


Parse.Cloud.job("Migrate_001_Pre_User_Matches_ChatMessage_UserIds", function(request, status) {
	Parse.Cloud.useMasterKey()
	var userQuery = new Parse.Query(Parse.User);
	userQuery.doesNotExist('matches');
	userQuery.limit(1000);

	var matchesQuery = new Parse.Query(Match);
	matchesQuery.equalTo('state', 'M');
	matchesQuery.limit(1000);

	var users;
	var matches;

	return userQuery.find().then(function(result) {
		users = result;
		console.log('found ' + users.length + ' users without a matches property');
		return matchesQuery.find();
	}).then(function(result) {
		matches = result
		console.log('loaded ' + matches.length + ' mutual matches');

		var usersById = {};
		var j, user;
		for(j=0; j<users.length; j++) {
			user = users[j];
			usersById[user.id] = user;
		}

		var i;
		var match;
		var user1, user2;

		for(i = 0; i < matches.length ; i++) {
			match = matches[i];

			user1 = usersById[match.get('uid1')]
			user2 = usersById[match.get('uid2')]

			console.log('adding match ' + match.id + ' to ' + user1.id + ' and ' + user2.id)

			user1.addUnique('matches', match.id)
			user2.addUnique('matches', match.id)
		}

		console.log('saving ' + users.length + ' users...')
		return Parse.Object.saveAll(users)
	}).then(function(result) {

		// save the match user ids on the the chat messages
		var msgQuery = new Parse.Query(ChatMessage);
		msgQuery.doesNotExist('usersIds');
		msgQuery.limit(1000);
		console.log('loading messages...')
		return msgQuery.find();
	}).then(function(msgs) {
		console.log('loaded ' + msgs.length + ' messages');
		var matchesById = {};
		var j, match;
		for(j=0; j<matches.length; j++) {
			match = matches[j];
			matchesById[match.id] = match
		}

		var i;
		var userIds, msg, match;
		for(i = 0; i< msgs.length; i++) {
			msg = msgs[i];
			match = matchesById[msg.get('match').id];
			msg.set('userIds', [match.get('uid1'), match.get('uid2')])
		}
		console.log('saving messages...')
		return Parse.Object.saveAll(msgs)
	}).then(function(result) {
		status.success('migration complete')
	}, function(error) {
		status.error('migration error ' + JSON.stringify(error))
	})

});