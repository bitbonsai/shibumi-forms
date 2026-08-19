import { loadConfig } from "../src/config";
import { migrate, openDatabase } from "../src/database";

process.umask(0o077);
const config = loadConfig();
const database = openDatabase(config.databasePath);

try {
  migrate(database);
  console.log("Migrations complete");
} finally {
  database.close();
}
