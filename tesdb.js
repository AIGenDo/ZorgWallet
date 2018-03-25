/******************************************************************************
  tesdb

    Database functions create, connect, store, retrieve, etc.
    Using CouchDB and nano (minimalistic CouchDB driver for node.js)


    Copyright Trusting Edge 2018 - All Rights Reserved

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

******************************************************************************/
'use strict';

var nano = require('nano')('http://localhost:5984');


// Export methods
module.exports = {

  /**********
  getObject

    @argument 1: Database connection id
    @argument 2: Object id
    @argument 3: Call back function (error, http response body, response header)
    @return: HTTP body (requested object) or error

  **********/
  getObject: function (db, objectId, cb) {
    console.log("Entered getObject - id = %s", objectId);

    db.get(objectId, function(err, body, header) {
      if (err) {
        console.log("getObject - error call back from db.get: ", err);
        cb(err, null);
      } else {
        console.log("getObject - successful call back from db.get - requested object: %j", body);
        cb(null, body);
      }
    });
  },

  /**********
  addObject

    @argument 1: Database connection id
    @argument 2: Object id
    @argument 3: JSON object
    @argument 4: Call back function (error, http response body, response header)
    @return: HTTP body (response) or error

  **********/
  addObject: function (db, objectId, object, cb) {
    console.log("Entered addObject - id: %s, JSON object: %j", objectId, object);

    var t = new Date();
    object.timestamp = t.toJSON();

    db.insert(object, objectId, function(err, body, header) {
      if (err) {
        console.log("addObject - error call back from db.insert: ", err);
        cb(err, null);
      } else {
        console.log("addObject - successful call back from db.insert - response: %j", body);
        cb(null, body);
      }
    });
  },

  /**********
  updObject

    @argument 1: Database connection id
    @argument 2: Object id
    @argument 3: JSON object
    @argument 4: Call back function (error, http response body, response header)
    @return: HTTP body (response) or error

  **********/
  updObject: function (db, objectId, object, cb) {
    console.log("Entered updObject - id: %s, JSON object: %j", objectId, object);

    // Get the existing object / document, if it exists
    db.get(objectId, function (err, body, header) {
      if (err) {
        console.log("updObject - requested object does not yet exist or has been deleted, and that's OK");
      } else {
        console.log("updObject - successful call back from db.get - existing object: %j", body);
        object._rev = body._rev;
      }

      var t = new Date();
      object.timestamp = t.toJSON();

      db.insert(object, objectId, function(err, body, header) {
        if (err) {
          console.log("updObject - error call back from db.insert: ", err);
          cb(err, null);
        } else {
          console.log("updObject - successful call back from db.insert - response: %j", body);
          cb(null, body);
        }
      });
    });
  },

  /**********
  delObject

    @argument 1: Database connection id
    @argument 2: Object id
    @argument 3: Call back function (error, http response body, response header)
    @return: HTTP body (response) or error

  **********/
  delObject: function (db, objectId, cb) {
    console.log("Entered delObject - id: %s", objectId);

    // Get the existing object / document
    db.get(objectId, function (err, body, header) {
      if (err) {
        console.log("delObject - error call back from db.get: ", err);
        cb(err, null);
      } else {
        console.log("delObject - deleting object %j", body);
        db.destroy(objectId, body._rev, function(err, body, header) {
          if (err) {
            console.log("delObject - error call back from db.destroy: ", err);
            cb(err, null);
          } else {
            console.log("delObject - successful call back from db.destroy - response: %j", body);
            cb(null, body);
          }
        });
      }
    });
  },

  /**********
  getAttachment

    @argument 1: Database connection id
    @argument 2: Object id
    @argument 3: Attachment name
    @argument 4: Call back function (error, http response body, response header)
    @return: HTTP body (attachment data) or error

  **********/
  getAttachment: function (db, objectId, attName, cb) {
    console.log("Entered getAttachment - id: %s, attachment: %s", objectId, attName);

    // Get the existing object / document
    db.get(objectId, function (err, body, header) {
      if (err) {
        console.log("getAttachment - requested object does not yet exist or has been deleted");
        cb(err, null);
      } else {
        console.log("getAttachment - successful call back from db.get - existing object: %j", body);
      }

      db.attachment.get(objectId, attName, function(err, body, header) {
        if (err) {
          console.log("getAttachment - error call back from db.attachment.get: ", err);
          cb(err, null);
        } else {
          console.log("getAttachment - successful call back from db.attachment.get - attachment: %s", attName);
          cb(null, body);
        }
      });
    });
  },

  /**********
  addAttachment

    @argument 1: Database connection id
    @argument 2: Object id
    @argument 3: Attachment name
    @argument 4: Attachment data (binary object)
    @argument 5: Attachment content type, e.g. "image/png"
    @argument 6: Call back function (error, http response body, response header)
    @return: HTTP body (response) or error

  **********/
  addAttachment: function (db, objectId, attName, attData, attType, cb) {
    console.log("Entered addAttachment - id: %s, attachment: %s, attachment type: %s",
                    objectId, attName, attType);

    // Get the existing object / document
    db.get(objectId, function (err, body, header) {
      if (err) {
        console.log("addAttachment - requested object does not yet exist or has been deleted");
        cb(err, null);
      } else {
        console.log("addAttachment - successful call back from db.get - existing object: %j", body);
      }

      db.attachment.insert(objectId, attName, attData, attType, { rev: body._rev}, function(err, body, header) {
        if (err) {
          console.log("addAttachment - error call back from db.attachment.insert: ", err);
          cb(err, null);
        } else {
          console.log("addAttachment - successful call back from db.attachment.insert - response: %j", body);
          cb(null, body);
        }
      });
    });
  },

  /**********
  listDB

    @return:

  **********/
  listDB: function () {
    console.log("Entered listDB");

    // Get list of all the databases in CouchDB
    nano.db.list(function(err, body, header) {
      if (!err) {
        // body is an array
        var i = 0;
        body.forEach(function(db) {
          ++i;
          console.log("CouchDB database %d: %s", i, db);
        });
      }
    });
  },

  /**********
  connectDB

    @argument 1: Database name
    @return: Database connection id

  **********/
  connectDB: function (dbname) {
    console.log("Entered connectDB - database: ", dbname);

    return nano.use(dbname);
  },

  /**********
  createDB

    @argument 1: Database name
    @argument 2: Call back function (error, http response body, response header)
    @return: HTTP body (response) or error

  **********/
  createDB: function (dbname, cb) {
    console.log("Entered createDB - database: ", dbname);

    nano.db.create(dbname, function(err, body, header) {
      if (err) {
        console.log("createDB - error call back from db.create: ", err);
        cb(err, null);
      } else {
        console.log("createDB - successful call back from db.create - body %j, header %j", body, header);
        cb(null, body);
      }
    });
  }

} // End of module.exports
