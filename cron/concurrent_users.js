const async = require( 'async' );
const fs = require('fs');
const data_file = "./scripts/concurent_users/inst.json"
// --------------------------------------------------------------------------------------
var exp = {}
// --------------------------------------------------------------------------------------
// perform mac address counting
// --------------------------------------------------------------------------------------
exp.process_old_data = function (database, callback) {
  // find the lowest date in database and go from that date to present
  var data = JSON.parse(fs.readFileSync(data_file, 'utf8'));
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
          search(database, data, min, max, done);     // calls done when finished
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
        console.log("cron task concurrent_users finished processing old data");
      callback(null, null);
    });
  });
};
// --------------------------------------------------------------------------------------
// perform mac address counting
// --------------------------------------------------------------------------------------
exp.process_current_data = function (database) {
  var data = JSON.parse(fs.readFileSync(data_file, 'utf8'));
  var curr = new Date();        // current day
  curr.setHours(0);
  curr.setMinutes(0);
  curr.setSeconds(0);
  curr.setMilliseconds(0);
  var prev_min = new Date(curr);
  prev_min.setDate(prev_min.getDate() -1); // previous day hh:mm:ss:ms set to 00:00:00:000
  var prev_max = new Date(curr);           // current day hh:mm:ss:ms set to 00:00:00:000
                                           // search uses lower than max condition !
  search(database, data, prev_min, prev_max);
};
// --------------------------------------------------------------------------------------
// search input data
// --------------------------------------------------------------------------------------
function search(database, data, min, max, done)
{
  async.forEachOf(data, function (value_visinst_1, key_visinst_1, callback_visinst_1) {
    async.forEachOf(data[key_visinst_1].institutions, function (value_visinst_2, key_visinst_2, callback_visinst_2) {
      // "continue" implementation - TODO
      if(data[key_visinst_1].institutions[key_visinst_2].institution == data[key_visinst_1].institution)
        callback_visinst_2(null);
      else {
        dict = { 
          visinst_1 : data[key_visinst_1].institution, visinst_2 : data[key_visinst_1].institutions[key_visinst_2].institution,
          dist : data[key_visinst_1].institutions[key_visinst_2].dist, time : data[key_visinst_1].institutions[key_visinst_2].time,
        };

        search_db(database, dict, min, max, callback_visinst_2);        // search db
      }
    }, function (err) {
      if (err)
        console.error(err);
      callback_visinst_1(null); // all insistituons for visinst_1 processed
    });
  }, function (err) {
    if (err)
      console.error(err);
    done(null, null);   // all done
  });
}
// --------------------------------------------------------------------------------------
// perform database search
// --------------------------------------------------------------------------------------
function search_db(database, data, min, max, done)
{
  database.logs.aggregate([ 
    // initial limit by timestamp, non empty pn and result
    { $match : { timestamp : { $gte : min, $lt : max }, pn : { $ne : "" }, result : "OK" } },
    { $match : { pn : { $nin : [ /^anonymous@.*$/, /^@.*$/ ] } } }, // no anonymous users
    { $match : { visinst : { $in : [ data.visinst_1, data.visinst_2 ] } } },       // limit by visinst
    { $group : { _id : { pn : "$pn"} , visinst : { $addToSet : "$visinst" } } },   // group by pn, add visinst to array
    { $match : { visinst : { $all : [ data.visinst_1, data.visinst_2 ] } } },       // both visinst have to match
    { $project : { pn : "$_id.pn", visited_count : { $size : "$visinst" }, _id : 0 } },     // project pn, get size of array
    { $match : { visited_count : { $gt : 1 } } },                                  // more than one institution
    { $project : { pn : 1 } }
  ],
    function (err, items) {
      if(err == null && items.length > 0) {
        //console.log(data.visinst_1, data.visinst_2);
        //console.log(items);
        search_users(database, min, max, data, items, done);
        //done(); // TODO
      }
      else
        console.error(err);

      // TODO
      //if(err == null) {
      //  if(done)    // processing older data
      //    save_to_db_callback(database, transform(items, min), done);
      //  else    // current data processing, no callback is needed
      //    save_to_db(database, transform(items, min));    // add timestamp in transform
      //}
      //else
      //  console.error(err);
  });
}
// --------------------------------------------------------------------------------------
// search database for specific users
// --------------------------------------------------------------------------------------
function search_users(database, min, max, data, users, done)
{
  async.forEachOf(users, function (value, key, callback) {
    database.logs.aggregate([ 
      // initial limit by timestamp, username, result

      { $match : { timestamp : { $gte : min, $lt : max }, pn : users[key].pn, result : "OK" } },
      { $match : { visinst : { $in : [ data.visinst_1, data.visinst_2 ] } } },       // limit by visinst

      //{ $match : { pn : { $nin : [ /^anonymous@.*$/, /^@.*$/ ] } } }, // no anonymous users
      //{ $group : { _id : { pn : "$pn"} , visinst : { $addToSet : "$visinst" } } },   // group by pn, add visinst to array
      //{ $project : { pn : "$_id.pn", visited_count : { $size : "$visinst", _id : 0 } } },     // project pn, get size of array
      //{ $match : { visited_count : { $gt : 1 } } },                                  // more than one institution
      //{ $project : { pn : "$pn" } }
    ],
      function (err, items) {
        if(err == null && items.length > 0)
          analyze_data(items, data, done)
        else
          console.error(err);

        // TODO
        //if(err == null) {
        //  if(done)    // processing older data
        //    save_to_db_callback(database, transform(items, min), done);
        //  else    // current data processing, no callback is needed
        //    save_to_db(database, transform(items, min));    // add timestamp in transform
        //}
        //else
        //  console.error(err);
    });
    
    // TODO - callback
  }, function (err) {
    if (err)
      console.error(err);
    done(null); // all users done
  });
}
// --------------------------------------------------------------------------------------
// analyze all records for one user and two visited institutions
// --------------------------------------------------------------------------------------
function analyze_data(items, data, done)
{
  // items are implicly sorted by time

  //for(var item in items) {
  //  
  //}
  
  var idx = 0;
  var visinst = items[0].visinst;
  
  while(idx < items.length - 1) {
    while(items[idx].visinst == visinst && idx < items.length - 1) {
      idx++;
    }
    // visinst changed

    console.log(items[idx - 1]);
    console.log(items[idx]);
    console.log("=======================");


    // set new visinst
    visinst = items[idx].visinst;
    continue;
  }

  done(null);   // TODO
}
// --------------------------------------------------------------------------------------
// save data to dabase
// --------------------------------------------------------------------------------------
function save_to_db(database, items) {
  //for(var item in items) {  // any better way to do this ?
  //  database.mac_count.update(items[item], items[item], { upsert : true },
  //  function(err, result) {
  //    if(err)  
  //      console.error(err);
  //  });
  //}
}
// --------------------------------------------------------------------------------------
// save data to database with callback
// --------------------------------------------------------------------------------------
function save_to_db_callback(database, items, done) {
  //async.forEachOf(items, function (value, key, callback) {
  //  database.mac_count.update(items[key], items[key], { upsert : true },
  //  function(err, result) {
  //    if(err)
  //      console.error(err);
  //    callback(null);   // save next item
  //  });
  //}, function (err) {
  //  if (err)
  //    console.error(err);
  //  done(null, null);   // all items are saved
  //});
}
// --------------------------------------------------------------------------------------
// transform data for saving to database
// --------------------------------------------------------------------------------------
function transform(items, db_date)
{
  var arr = [];

  for(var item in items) {
    items[item].timestamp = db_date;
    arr.push(items[item]);
  }

  return arr;
}
// --------------------------------------------------------------------------------------
module.exports = exp;

