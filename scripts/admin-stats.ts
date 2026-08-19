import { loadConfig } from "../src/config";
import { openDatabase } from "../src/database";

const database = openDatabase(loadConfig().databasePath);
try {
  const counts = Object.fromEntries(["users", "forms", "submissions", "sessions"].map((table) => [table, database.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table}`).get()!.count]));
  console.log(JSON.stringify(counts));
} finally { database.close(); }
