import "../src/lib/db";
import { rawDb } from "../src/lib/db";

const count = (rawDb.prepare("SELECT COUNT(*) AS count FROM categories").get() as { count: number }).count;
console.log(`Banco SQLite legado inicializado com ${count} categorias padrão.`);
