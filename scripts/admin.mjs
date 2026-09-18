import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";

async function secret(prompt) {
  if (!process.stdin.isTTY)
    throw new Error(
      "Usa una terminal interactiva: docker compose exec app node scripts/admin.mjs",
    );
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const handler = (str, key) => {
      if (key?.ctrl && key.name === "c") {
        done();
        reject(new Error("Cancelado"));
      } else if (key?.name === "return") {
        done();
        resolve(value);
      } else if (key?.name === "backspace") value = value.slice(0, -1);
      else if (str && !key?.ctrl && value.length < 128) value += str;
    };
    function done() {
      process.stdin.removeListener("keypress", handler);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    }
    process.stdin.on("keypress", handler);
  });
}
try {
  const path = resolve(
    process.env.DATA_DIR ?? "runtime/data",
    "face-lab.sqlite",
  );
  const db = new Database(path, { fileMustExist: true });
  const existing = db
    .prepare("SELECT password_hash FROM admins WHERE id=?")
    .get("admin");
  if (
    existing &&
    !(await bcrypt.compare(
      await secret("Contraseña actual: "),
      existing.password_hash,
    ))
  )
    throw new Error("Contraseña actual incorrecta");
  const password = await secret(
    "Nueva contraseña (mínimo 12 caracteres; no se muestra): ",
  );
  if (password.length < 12 || Buffer.byteLength(password) > 72)
    throw new Error("Usa entre 12 caracteres y 72 bytes UTF-8.");
  if (password !== (await secret("Repite la contraseña: ")))
    throw new Error("Las contraseñas no coinciden");
  const hash = await bcrypt.hash(password, 12);
  db.transaction(() => {
    db.prepare(
      "INSERT INTO admins VALUES(?,?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash",
    ).run("admin", hash);
    db.prepare("DELETE FROM sessions").run();
    db.prepare("UPDATE face_challenges SET used=1").run();
  })();
  db.close();
  console.log("Administrador configurado. Abre http://localhost:8091");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
