import "../src/lib/db";
import { getCategories } from "../src/lib/finance/service";

console.log(`SQLite inicializado com ${getCategories().length} categorias padrão.`);
