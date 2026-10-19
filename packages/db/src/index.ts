import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export * from "./mappers";

let client: PrismaClient | undefined;

/** Process-wide Prisma client. */
export function getPrisma(): PrismaClient {
  client ??= new PrismaClient();
  return client;
}

/** Error raised by the scaling_cycles cooldown trigger, if `err` is one. */
export function cooldownViolation(err: unknown): "cooldown_active" | "execution_in_progress" | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("cooldown_active")) return "cooldown_active";
  if (msg.includes("execution_in_progress")) return "execution_in_progress";
  return null;
}
