module.exports = function (dbUrl) {

	var MongoClient = require('mongodb').MongoClient

	MongoClient.connect(dbUrl, function(err, db) {
		if(err) {
			console.log('Error connecting to Mongo to update indexes', err)
			return
		}

		console.log('Updating Mongo indexes')
		// db._User.createIndex( { "createdAt": 1}, {background: true} )
		try {
			var profile = db.collection('Profile')
			profile.createIndex({"createdAt": 1}, {background: true})
			profile.createIndex({location: "2dsphere", updatedAt: -1}, {background: true})
			profile.createIndex({"uid": 1}, {background: true})

			var match = db.collection('Match')
			match.createIndex({"uid1": 1}, {background: true})
			match.createIndex({"uid2": 1}, {background: true})
			match.createIndex({"uid1": 1, "uid2": 1}, {background: true, unique: true})

			db.close()
		} catch(e) {
			console.log('Error updating Mongo indexes', e)
		}
	})

	return {}
}
