import { Pool } from "pg";
import { buildApp } from "./app.js";
import { Store } from "./store.js";
import { PgStore } from "./pg-store.js";

const port = Number(process.env.PORT ?? 3000);
const usePostgres =
  process.env.STORE === "postgres" ||
  (process.env.STORE !== "memory" && Boolean(process.env.DATABASE_URL));

const store = usePostgres
  ? new PgStore(new Pool({ connectionString: process.env.DATABASE_URL }))
  : new Store();

const app = buildApp(store);

app
  .listen({ port, host: "0.0.0.0" })
  .then((address) => {
    console.log(
      `anari-incentive API listening on ${address} (${usePostgres ? "postgres" : "memory"})`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
