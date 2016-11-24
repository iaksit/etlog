const async = require( 'async' );
// --------------------------------------------------------------------------------------
var exp = {}
// --------------------------------------------------------------------------------------
// process old data through days until current day 
// get roaming collection data
// --------------------------------------------------------------------------------------
exp.process_old_data = function (database, callback) {
  // find the lowest date in database and go from that date to present
  var date;
  var current = new Date();
  var curr_min = new Date(current.getFullYear(), current.getMonth(), current.getUTCDate(), 0, 0, 0, 0);   // current day hh:mm:ss:ms set to 00:00:00:000

  // find all, sort by timestamp, display only timestamp, display one document only
  database.logs.find({}).sort({"timestamp" : 1}).limit(1).select({"timestamp" : 1, "_id" : 0}).exec(
  function(err, doc) {
    var date = doc;

    date = String(date[0]["timestamp"]);    // get only string representation of date

    var fields = date.split(" ");
    var months = {      // months dict for date constructor
      "Jan" : 0,
      "Feb" : 1,
      "Mar" : 2,
      "Apr" : 3,
      "May" : 4,
      "Jun" : 5,
      "Jul" : 6,
      "Aug" : 7,
      "Sep" : 8,
      "Oct" : 9,
      "Nov" : 10,
      "Dec" : 11
    }

    var min = new Date(fields[3], months[fields[1]], fields[2], 0, 0, 0, 0);        // hh:mm:ss:ms set to 0
    var max = new Date(fields[3], months[fields[1]], Number(fields[2]) + 1, 0, 0, 0, 0);    // next day, hh:mm:ss:ms set to 0
                                                                                    // search uses lower than max condition !
    // this date handling should guarantee correct interval for all processed records

    async.whilst(function () {
      return min < curr_min;
    },
    function(next) {
      async.series([
        function(done) {
          process_data(database, min, max, done);     // calls done when finished
        },
        function(done) {
          min.setDate(min.getDate() + 1);  // continue
          max.setDate(max.getDate() + 1);  // continue
          done(null);                      // done
        }
        ],
        function(err, results) {
          next();   // next whilst iteration
      });
    },
    function(err) {
      if(err)
        console.error(err);
      else
        console.log("cron task roaming finished processing old data");
      callback(null, null);
    });
  });
};
// --------------------------------------------------------------------------------------
// function for current data
// get roaming collection data
// --------------------------------------------------------------------------------------
exp.process_current_data = function (database) {
  var curr = new Date();        // current day
  curr.setHours(0);
  curr.setMinutes(0);
  curr.setSeconds(0);
  curr.setMilliseconds(0);
  var prev_min = new Date(curr);
  prev_min.setDate(prev_min.getDate() -1); // previous day hh:mm:ss:ms set to 00:00:00:000
  var prev_max = new Date(curr);           // current day hh:mm:ss:ms set to 00:00:00:000
                                           // search uses lower than max condition !
  process_data(database, prev_min, prev_max);
};
// --------------------------------------------------------------------------------------
function process_data(database, min_date, max_date, done)
{
  async.series([
    function(finished) {
      get_most_provided(database, min_date, max_date, finished);
    },
    function(finished) {
      get_most_used(database, min_date, max_date, finished);
    }
    ],
    function(err, results) {
      if(done)  // no callback needed for current data
        done(null);                      // both most_provided and most_used are done
  });
}
// --------------------------------------------------------------------------------------
// get data for organisations most providing roaming
// --------------------------------------------------------------------------------------
function get_most_provided(database, min_date, max_date, done)
{
  database.logs.aggregate(
  [ 
  { 
    $match : 
      { 
        timestamp : 
          {
            $gte : min_date, 
            $lt : max_date 
          }, 
        result : "OK"         // only successfully authenticated users
      } 
  },  
  {
    $group :                  // group by pair [realm, csi] - normalization by mac address
      { 
        _id : 
          { 
            realm : "$realm", 
            csi : "$csi" 
          } 
      } 
  },
  { 
    $project : 
      { 
        "_id.realm" : 1             // we need only realm
      } 
  }, 
  { 
    $group :                // group by realm
      { 
        _id : 
          { 
            realm : "$_id.realm" 
          }, 
        count : 
          { 
            $sum : 1        // count number of records for given realm
          } 
      } 
  }
  ],
    function(err, items) {
      if(err == null) {
        if(done)    // processing older data
          save_to_db_callback(database, transform_provided(items, min_date), done);
        else    // current data processing, no callback is needed
          save_to_db(database, transform_provided(items, min_date));
      }
      else
        console.error(err);
  });
}
// --------------------------------------------------------------------------------------
// save data to database
// --------------------------------------------------------------------------------------
function save_to_db(database, items)
{
  for(var item in items) {  // any better way to do this ?
    database.roaming.update(items[item], items[item], { upsert : true },
    function(err, result) {
      if(err)
        console.error(err);
    });
  }
}
// --------------------------------------------------------------------------------------
// save data to database with callback
// --------------------------------------------------------------------------------------
function save_to_db_callback(database, items, done) {
  async.forEachOf(items, function (value, key, callback) {
    database.roaming.update(items[key], items[key], { upsert : true },
    function(err, result) {
      if(err)
        console.error(err);
      callback(null);   // save next item
    });
  }, function (err) {
    if (err)
      console.error(err);
    done(null, null);   // all items are saved
  });
}
// --------------------------------------------------------------------------------------
// transform data for saving to database
// --------------------------------------------------------------------------------------
function transform_provided(items, db_date)
{
  var arr = [];
  var dict = {};

  for(var item in items) {
    dict = {};
    dict['inst_name'] = items[item]['_id']['realm'];
    dict['provided_count'] = items[item]['count'];
    dict['timestamp'] = db_date;
    arr.push(dict);
  }

  return arr;
}
// --------------------------------------------------------------------------------------
// transform data for saving to database
// --------------------------------------------------------------------------------------
function transform_used(items, db_date)
{
  var arr = [];
  var dict = {};

  for(var item in items) {
    dict = {};
    dict['inst_name'] = items[item]['_id']['visinst'];
    dict['used_count'] = items[item]['count'];
    dict['timestamp'] = db_date;
    arr.push(dict);
  }

  return arr;
}
// --------------------------------------------------------------------------------------
// get data for organisations most using roaming
// --------------------------------------------------------------------------------------
function get_most_used(database, min_date, max_date, done)
{
  database.logs.aggregate(
  [ 
  { 
    $match : 
      { 
        timestamp : 
          { 
            $gte : min_date,
            $lt : max_date 
          }, 
        result : "OK",          // match only successful logins
        visinst : 
          { 
            $ne : "UNKNOWN"       // no unknown institutions
          }
      } 
  },  
  { 
    $group :                    // group by pair [visinst, csi] - normalization by mac address
      {
        _id : 
          { 
            visinst : "$visinst", 
            csi : "$csi" 
          } 
      } 
  },
  { 
    $project : 
    { 
      "_id.visinst" : 1              // we want only visinst
    } 
  }, 
  { 
    $group :                   // group by visinst
      { 
        _id : 
          { 
            visinst : "$_id.visinst" 
          }, 
        count : 
          { 
            $sum : 1           // count number of current visinst
          } 
      } 
  }
  ],
    function(err, items) {
      if(err == null) {
        if(done)    // processing older data
          save_to_db_callback(database, transform_used(items, min_date), done);
        else    // current data processing, no callback is needed
          save_to_db(database, transform_used(items, min_date));
      }
      else
        console.error(err);
  });
}
// --------------------------------------------------------------------------------------
module.exports = exp;
