// Entry point for hosts that expect a root-level startup file (Hostinger /
// Passenger). The real server lives in the nested standalone output; it
// chdir()s to its own directory on startup, so requiring it from here is safe.
require("./apps/web/server.js");
