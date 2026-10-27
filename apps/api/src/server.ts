import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const app = buildApp();

app
  .listen({ port, host: "0.0.0.0" })
  .then((address) => {
    console.log(`anari-incentive API listening on ${address}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
