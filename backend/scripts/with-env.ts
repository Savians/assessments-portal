import { spawn } from "node:child_process";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

const [, , envFile, command, ...args] = process.argv;

if (!envFile || !command) {
  console.error("Usage: ts-node scripts/with-env.ts <env-file> <command> [...args]");
  process.exit(1);
}

const backend = path.resolve(__dirname, "..");
const envPath = path.isAbsolute(envFile) ? envFile : path.join(backend, envFile);
const result = loadDotenv({ path: envPath });

if (result.error) {
  console.error(`Could not load env file: ${envPath}`);
  console.error(result.error.message);
  process.exit(1);
}

const child = spawn(command, args, {
  cwd: backend,
  env: process.env,
  shell: true,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Command terminated by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
