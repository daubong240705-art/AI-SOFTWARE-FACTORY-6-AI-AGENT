// better-sqlite3 13 ships Node-API binaries shared by Node and Electron.
// Do not run electron-rebuild: no compiler/toolchain is needed on Windows x64.
const Database = require("better-sqlite3");
const database = new Database(":memory:");
database.prepare("SELECT sqlite_version()").get();
database.close();
console.log("SQLite Node-API binary ready.");
