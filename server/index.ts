import { resolve } from "node:path";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { cleanup, openDatabase } from "./db.js";
const db = openDatabase(resolve(config.DATA_DIR, "face-lab.sqlite"));
db.prepare("UPDATE face_challenges SET used=1 WHERE used=0").run();
const { app, lab } = createApp(db);
const server = app.listen(config.PORT, "0.0.0.0", () =>
  console.info("Local face lab started on port " + config.PORT),
);
const cleanupTimer = setInterval(() => {
  cleanup(db);
  lab.reap();
}, 30000);
cleanupTimer.unref();
server.requestTimeout = 15000;
server.headersTimeout = 10000;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    clearInterval(cleanupTimer);
    server.close(() => {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
      process.exit(0);
    });
  });
