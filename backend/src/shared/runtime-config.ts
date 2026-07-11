import { z } from "zod";

const runtimeConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  ENVIRONMENT: z.enum(["development", "test", "staging", "production"]).default("development"),
  SERVICE_NAME: z.string().min(1).default("foundation"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ASSESSMENT_SECRET_NAME: z.string().min(1).default("savians/assessment/local"),
  TABLE_PREFIX: z.literal("assessment_").default("assessment_"),
  S3_PREFIX: z.literal("assessments/").default("assessments/")
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

let cached: RuntimeConfig | undefined;

export function getRuntimeConfig(): RuntimeConfig {
  cached ??= runtimeConfigSchema.parse(process.env);
  return cached;
}

export function clearRuntimeConfigForTests(): void {
  cached = undefined;
}

