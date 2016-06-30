var _ = require('underscore')
var config = require('./config.js')

var LinkedInLink = Parse.Object.extend('LinkedInLink')
var Profile = Parse.Object.extend('Profile')


// ACL for the LinkedInLink objects.
var restrictedAcl = new Parse.ACL()
restrictedAcl.setPublicReadAccess(false)
restrictedAcl.setPublicWriteAccess(false)


function getUsername(profileData) {
	return 'LinkedIn_' + profileData.id
}

// Gets the password which can be used to login from the server code
function getPassword(profileData) {
	return config.passwordPrefix + profileData.id
}

Parse.Cloud.define('LoadLinkedInMember', function (request, response) {
	var authData = request.params.authData

	// https://developer.linkedin.com/docs/fields/basic-profile
	var profileRequestOptions = {url: 'https://api.linkedin.com/v1/people/~:(id,firstName,lastName,emailAddress,location,positions,picture-url,picture-urls::(original))?format=json',
		headers: {'Authorization': 'Bearer ' + authData.access_token}}

	var profileData

	Parse.Cloud.httpRequest(profileRequestOptions)
		.then(function(httpResponse) {
			profileData = httpResponse.data
			return upsertLinkedInUser(profileData)
		})
		.then(function(user) {
			user.setUsername(getUsername(profileData))
			user.setPassword(getPassword(profileData))
			return user.logIn()
		})
		.then(function(user) {
			return response.success(user.getSessionToken())
		}, function(error) {
			response.error(error)
		})
})


/**
 * This function checks to see if this LinkedIn user has logged in before.
 * It expects a class in your Parse App called 'LinkedInLink' which is a simple table that links Parse Users to linkeIn Ids
 * the LinkedInLink class should have two columns :
 *      'user' : pointer to Parse User
 *      'linkInId' : string that holds the unique LinkedIn user ID
 * If the user is found return
 *   the users token.  If not found, return the newLinkedInUser promise.
 */
function upsertLinkedInUser(profileData) {

	var query = new Parse.Query(LinkedInLink)
	query.equalTo('linkedInId', profileData.id)
	query.ascending('createdAt')

	// Check if this linkedInId has previously logged in, using the master key
	return query.first({ useMasterKey: true }).then(function (tokenData) {
		// If not, create a new user.
		if (!tokenData)
			return newLinkedInUser(profileData)

		// If found, fetch the user.
		var user = tokenData.get('user')
		return user.fetch({ useMasterKey: true }).then(function (user) {
			return tokenData.save(null, { useMasterKey: true })
		}).then(function (obj) {
			// Return the user object.
			return Parse.Promise.as(user)
		})
	})
}

/**
 * This function creates a Parse User with a random  password, and
 *   associates it with an object in the LinkedInLink class.
 * Once completed, this will return upsertLinkedInUser.  This is done to protect
 *   against a race condition:  In the rare event where 2 new users are created
 *   at the same time, only the first one will actually get used.
 */
var newLinkedInUser = function (linkedInData) {
	console.log('Creating new LinkedIn user')
	var user = new Parse.User()

	// Create a username and password which is secret to us, so we can log in with it later
	user.set('username', getUsername(linkedInData))
	user.set('password', getPassword(linkedInData))
	user.set('email', linkedInData.emailAddress)

	// Start saving the profile photo now so its ready when we're updating the Profile
	var profileImageFilePromise
	if(linkedInData.pictureUrls._total > 0) {
		profileImageFilePromise = Parse.Cloud.httpRequest({url: linkedInData.pictureUrls.values[0]})
			.then(function(httpResponse) {
				var file = new Parse.File('profile.jpeg', {base64: httpResponse.buffer.toString('base64', 0, httpResponse.buffer.length)})
				return file.save()
			}).then(function(file) {
				return file
			}, function(error) {
				console.error('Error saving LinkedIn profile image ' + JSON.stringify(error))
				// Catch any errors and return null. We don't want this failing to cause the whole process to fail
				return null
			})
	} else {
		profileImageFilePromise = Parse.Promise.as(null)
	}

	// Sign up the new User
	var returnValue
	return user.signUp().then(function (user) {
		// create a new LinkedInLink object to store the user+LinkedIn association.
		var link = new LinkedInLink()
		link.set('linkedInId', linkedInData.id)
		link.set('user', user)
		link.setACL(restrictedAcl)
		// Use the master key because LinkedInLink objects should be protected.
		return link.save(null, { useMasterKey: true })
	}).then(function (tokenStorage) {
		return upsertLinkedInUser(linkedInData)
	}).then(function(result) {
		returnValue = result
		// we've done the link save and upsertLinkedInUser first to make sure the Profile object
		// has been created in the User afterSave hook
		var profile = result.get('profile')
		if(!profile) {
			console.error('No profile object on LinkedIn sign up user: ' + JSON.stringify(result))
			return Parse.Promise.as(null)
		}
		return Parse.Promise.when(new Parse.Query(Profile).get(profile.id), profileImageFilePromise)

	}).then(function(profile, file) {

		if(profile) {
			profile.set('name', linkedInData.firstName)
			profile.set('surname', linkedInData.lastName)
			if(file)
				profile.add('photos', {name: file.name, url: file.url(), __type: 'File'})
			return profile.save()

		} else {
			return Parse.Promise.as(null)
		}
	}).then(function(result) {
		return returnValue
	})

}



Parse.Cloud.afterDelete(Parse.User, function(request) {
	Parse.Cloud.useMasterKey()
	var user = request.object

	// Delete any linked LinkedInLink
	var query = new Parse.Query(LinkedInLink)
	query.equalTo('user', user)
	query.find(function(links) {
		return Parse.Object.destroyAll(links, {useMasterKey: true})
	}).then(function(){}, function(error){
		console.error('Error deleting LinkedInLink for user ' + user.id + ' ' + JSON.stringify(error))
	})
})