#!/bin/bash
#
# Author: Václav Mach
# 
# This script runs fticks_to_json.sh and is intended to be run by cron at regular intervals.
# Script takes no arguments.

# current date in format YYYY-MM-DD
date=$(date "+%Y-%m-%d")

# database to which logs will be imported to
database="live"

# collection to which logs will be imported to
collection="logs"

# log file to process
logfile="/var/log/fticks-$date"

# error log
errlog="/var/log/fticks_err-$date.log"

# mongo error log
mongo_errlog="/var/log/mongo_err-$date.log"

# convert to json and import to database
/var/www/radlog/scripts/fticks_to_json.sh $logfile 2>>$errlog | mongoimport -d $database -c $collection 2>>$mongo_errlog

exit 0