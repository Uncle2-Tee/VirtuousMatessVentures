import { spawnSync } from "node:child_process";
import path from "node:path";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const prismaCommand = process.execPath;
const prismaScript = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const spawnOptions = { stdio: "inherit" };

if (process.env.DATABASE_URL) {
  const schemaArguments = [prismaScript, "db", "push", "--schema", "prisma/schema.prisma"];
  const pushResult = spawnSync(prismaCommand, schemaArguments, spawnOptions);

  if (pushResult.error) {
    console.error("Could not run Prisma schema synchronization:", pushResult.error.message);
    process.exit(1);
  }

  if (pushResult.status !== 0) {
    console.error("Prisma schema synchronization failed. No automatic data-loss confirmation was supplied.");
    process.exit(pushResult.status ?? 1);
  }
} else {
  console.warn("DATABASE_URL is not configured; skipping automatic Prisma schema synchronization.");
}

const generateResult = spawnSync(prismaCommand, [prismaScript, "generate", "--schema", "prisma/schema.prisma"], spawnOptions);

if (generateResult.error) {
  console.error("Could not regenerate Prisma Client:", generateResult.error.message);
  process.exit(1);
}

if (generateResult.status !== 0) {
  console.error("Prisma Client generation failed.");
  process.exit(generateResult.status ?? 1);
}
