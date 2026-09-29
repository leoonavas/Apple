import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: process.env.APP_DATA_DIR ? `${process.env.APP_DATA_DIR}/apple.sqlite` : "./.data/apple.sqlite" },
});
