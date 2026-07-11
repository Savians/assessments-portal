import { PrismaClient } from "@prisma/client";

let client: PrismaClient | undefined;
let activeDatabaseUrl: string | undefined;

export function getPrismaClient(databaseUrl: string): PrismaClient {
  if (!client || activeDatabaseUrl !== databaseUrl) {
    client = new PrismaClient({ datasourceUrl: databaseUrl });
    activeDatabaseUrl = databaseUrl;
  }
  return client;
}

