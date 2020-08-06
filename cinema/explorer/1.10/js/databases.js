
//
// inspect a string to determine what type it contains 
//
function db_get_database_list_type( dbs ) {
    result = ""

    dbs = dbs.trim()

    ext = db_get_file_extension( dbs )

    if (ext == "json") {
        result = "json"
    } else if (ext == "cdb") {
        result = "cdb"
    } else {
        result = "unknown"
        // TODO error if it's neither type
    }

    return result
}

//
// get the file name from a path string
//
function db_get_file_name(filename) {
    nameArray = filename.split('/');
    return nameArray[nameArray.length - 1];
}

//
// get the file extension from a path string
//
function db_get_file_extension(filename)
{
  var ext = /^.+\.([^.]+)$/.exec(filename);
  return ext == null ? "" : ext[1];
}
