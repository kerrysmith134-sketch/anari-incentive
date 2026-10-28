import type { AuthContext } from "@anari/auth";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}
