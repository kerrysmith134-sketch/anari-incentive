import { z } from "zod";

export const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "expected a decimal string");

export const uuidSchema = z.string().uuid();
