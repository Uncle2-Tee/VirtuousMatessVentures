import { spawnSync } from "node:child_process";
import path from "node:path";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const prismaCommand = process.execPath;
const prismaScript = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const spawnOptions = { stdio: "inherit" };

if (process.env.DATABASE_URL) {
  const schemaArguments = [prismaScript, "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate"];
  const pushResult = spawnSync(prismaCommand, schemaArguments, spawnOptions);

  if (pushResult.error) {
    console.error("Could not run Prisma schema synchronization:", pushResult.error.message);
    process.exit(1);
  }

  if (pushResult.status !== 0) {
    console.error("Prisma schema synchronization failed. No automatic data-loss confirmation was supplied.");
    process.exit(pushResult.status ?? 1);
  }

  const rlsArguments = [
    prismaScript,
    "db",
    "execute",
    "--schema",
    "prisma/schema.prisma",
    "--file",
    "prisma/enable-rls.sql",
  ];
  const rlsResult = spawnSync(prismaCommand, rlsArguments, spawnOptions);

  if (rlsResult.error) {
    console.error("Could not apply row-level security settings:", rlsResult.error.message);
    process.exit(1);
  }

  if (rlsResult.status !== 0) {
    console.error("Could not apply row-level security settings.");
    process.exit(rlsResult.status ?? 1);
  }
} else {
  console.warn("DATABASE_URL is not configured; skipping automatic schema and row-level security synchronization.");
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
