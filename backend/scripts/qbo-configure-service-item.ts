import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import { z } from "zod";

const tokenSchema = z.object({ access_token: z.string(), refresh_token: z.string() });
const companySchema = z.object({ CompanyInfo: z.object({ CompanyName: z.string(), LegalName: z.string().optional() }) });
const itemsSchema = z.object({ QueryResponse: z.object({ Item: z.array(z.object({ Id: z.string(), Name: z.string(), Type: z.string().optional(), Active: z.boolean().optional(), UnitPrice: z.number().optional(), IncomeAccountRef: z.object({ value: z.string(), name: z.string().optional() }).optional() })).optional() }) });
const backend = path.resolve(__dirname, "..");
const envPath = path.join(backend, ".env");
const responseError = async (response: Response, prefix: string): Promise<string> => {
  const body = await response.text();
  if (!body.trim()) return `${prefix} (${response.status})`;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; error_description?: unknown; Fault?: { Error?: Array<{ Message?: string; Detail?: string; code?: string }> } };
    const oauthError = typeof parsed.error === "string" ? parsed.error : undefined;
    const oauthDescription = typeof parsed.error_description === "string" ? parsed.error_description : undefined;
    const fault = parsed.Fault?.Error?.[0];
    const faultParts = [fault?.code, fault?.Message, fault?.Detail].filter(Boolean).join(": ");
    const detail = [oauthError, oauthDescription, faultParts].filter(Boolean).join(" - ");
    return detail ? `${prefix} (${response.status}): ${detail}` : `${prefix} (${response.status})`;
  } catch {
    return `${prefix} (${response.status}): ${body.slice(0, 500)}`;
  }
};

async function setEnv(name: string, value: string) {
  const original = await readFile(envPath, "utf8");
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const next = pattern.test(original) ? original.replace(pattern, line) : `${original.trimEnd()}\n${line}\n`;
  const temp = `${envPath}.tmp`;
  await writeFile(temp, next, { encoding: "utf8", mode: 0o600 });
  await rename(temp, envPath);
}

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

async function main() {
  const required = ["QB_CLIENT_ID", "QB_CLIENT_SECRET", "QB_REFRESH_TOKEN", "QB_REALM_ID", "QB_BASE_URL"] as const;
  for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);
  const realmId = process.env.QB_REALM_ID!;
  const auth = Buffer.from(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`).toString("base64");
  const tokenResponse = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: process.env.QB_REFRESH_TOKEN! })
  });
  if (!tokenResponse.ok) throw new Error(await responseError(tokenResponse, "QuickBooks OAuth refresh failed"));
  const token = tokenSchema.parse(await tokenResponse.json());
  await setEnv("QB_REFRESH_TOKEN", token.refresh_token);
  const headers = { authorization: `Bearer ${token.access_token}`, accept: "application/json" };
  const companyResponse = await fetch(`${process.env.QB_BASE_URL}/company/${realmId}/companyinfo/${realmId}`, { headers });
  if (!companyResponse.ok) throw new Error(await responseError(companyResponse, "QuickBooks company query failed"));
  const company = companySchema.parse(await companyResponse.json()).CompanyInfo;
  console.log(`Connected QuickBooks company: ${company.CompanyName} (realm ending ${realmId.slice(-4)})`);

  const query = encodeURIComponent("select * from Item where Active = true maxresults 1000");
  const response = await fetch(`${process.env.QB_BASE_URL}/company/${realmId}/query?query=${query}`, { headers });
  if (!response.ok) throw new Error(await responseError(response, "QuickBooks item query failed"));
  const items = itemsSchema.parse(await response.json()).QueryResponse.Item ?? [];
  const serviceItems = items.filter((item) => normalize(item.Type ?? "") === "service");
  const candidates = serviceItems.filter((item) => /tax|assessment/i.test(item.Name));
  const preferred = candidates.filter((item) => ["tax assessment plan", "savians tax assessment"].includes(normalize(item.Name)));
  console.log(`Found ${items.length} active items, ${serviceItems.length} services, and ${candidates.length} tax/assessment service candidates.`);
  for (const candidate of candidates) console.log(`CANDIDATE id=${candidate.Id} name=${candidate.Name}`);
  if (candidates.length === 0) {
    console.log("Items returned by this connected company:");
    for (const item of [...items].sort((a, b) => a.Name.localeCompare(b.Name))) console.log(`ITEM id=${item.Id} type=${item.Type ?? "unknown"} name=${item.Name}`);
    throw new Error("The connected QuickBooks company returned no Tax Assessment service item. Verify that QB_REALM_ID belongs to the sandbox company shown in the Products & services screen.");
  }
  const selected = preferred.length === 1 ? preferred[0] : candidates.length === 1 ? candidates[0] : undefined;
  if (!selected) throw new Error("Multiple matching service items exist and no unique Tax Assessment Plan item could be selected.");
  if (selected.UnitPrice !== 2997) throw new Error(`Tax Assessment Plan price must be 2997; QuickBooks returned ${selected.UnitPrice ?? "no price"}`);
  if (!selected.IncomeAccountRef?.value) throw new Error("Tax Assessment Plan must have an income account");
  await setEnv("QB_SERVICE_ITEM_ID_TAX_ASSESSMENT", selected.Id);
  console.log(`Configured QB_SERVICE_ITEM_ID_TAX_ASSESSMENT for: ${selected.Name}`);
  console.log(`Verified service item: active=${selected.Active !== false} price=${selected.UnitPrice} incomeAccount=${selected.IncomeAccountRef.name ?? "configured"}`);
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
