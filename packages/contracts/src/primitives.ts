import { z } from "zod/v3";

export const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "expected a decimal string");

export const uuidSchema = z.string().uuid();
