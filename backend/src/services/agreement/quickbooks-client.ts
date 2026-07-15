import { z } from "zod";
import type { ApplicationSecrets } from "../../shared/application-secrets";

const tokenSchema = z.object({ access_token: z.string(), refresh_token: z.string(), expires_in: z.number() });
const customerQuerySchema = z.object({ QueryResponse: z.object({ Customer: z.array(z.object({ Id: z.string() })).optional() }) });
const customerSchema = z.object({ Customer: z.object({ Id: z.string() }) });
const invoiceSchema = z.object({ Invoice: z.object({ Id: z.string(), DocNumber: z.string().optional(), Balance: z.number().optional() }) });
const invoiceLookupSchema = z.object({
  Invoice: z.object({
    Id: z.string(),
    DocNumber: z.string().optional(),
    Balance: z.number().optional(),
    TotalAmt: z.number().optional(),
    CurrencyRef: z.object({ value: z.string() }).optional()
  })
});
const invoicePaymentSettingsSchema = z.object({
  Invoice: z.object({
    Id: z.string(),
    SyncToken: z.string(),
    AllowOnlinePayment: z.boolean().optional(),
    AllowOnlineCreditCardPayment: z.boolean().optional(),
    AllowOnlineACHPayment: z.boolean().optional()
  })
});

export interface QuickBooksCustomerInput { displayName: string; email: string; phone: string; requestId: string; }
export interface QuickBooksInvoiceInput { customerId: string; email: string; amount: number; requestId: string; description: string; }
export interface QuickBooksInvoice { id: string; number?: string; balance: number; }
export interface QuickBooksInvoiceStatus { id: string; number?: string; balance: number; totalAmount?: number; currency?: string; }
export interface QuickBooksGateway {
  findOrCreateCustomer(input: QuickBooksCustomerInput): Promise<string>;
  createInvoice(input: QuickBooksInvoiceInput): Promise<QuickBooksInvoice>;
  sendInvoice(invoiceId: string, email: string, requestId: string): Promise<void>;
}

const requireConfig = (secrets: ApplicationSecrets) => {
  const parsed = z.object({
    QB_CLIENT_ID: z.string().min(1), QB_CLIENT_SECRET: z.string().min(1), QB_REFRESH_TOKEN: z.string().min(1),
    QB_REALM_ID: z.string().min(1), QB_SERVICE_ITEM_ID_TAX_ASSESSMENT: z.string().min(1), QB_BASE_URL: z.string().url(),
    QB_MINOR_VERSION: z.string().optional()
  }).parse(secrets);
  return parsed;
};

const qboEscape = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const qboErrorMessage = async (response: Response, prefix: string): Promise<string> => {
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

export class IntuitQuickBooksGateway implements QuickBooksGateway {
  private accessToken?: string;
  private refreshToken: string;
  private readonly config: ReturnType<typeof requireConfig>;

  constructor(secrets: ApplicationSecrets, private readonly persistRefreshToken: (expected: string, next: string) => Promise<void>) {
    this.config = requireConfig(secrets);
    this.refreshToken = this.config.QB_REFRESH_TOKEN;
  }

  private async refreshAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${this.config.QB_CLIENT_ID}:${this.config.QB_CLIENT_SECRET}`).toString("base64"),
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.refreshToken })
    });
    if (!response.ok) throw new Error(await qboErrorMessage(response, "QuickBooks OAuth refresh failed"));
    const token = tokenSchema.parse(await response.json());
    await this.persistRefreshToken(this.refreshToken, token.refresh_token);
    this.refreshToken = token.refresh_token;
    this.accessToken = token.access_token;
    return token.access_token;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await this.refreshAccessToken();
    const separator = path.includes("?") ? "&" : "?";
    const minor = this.config.QB_MINOR_VERSION ? `${separator}minorversion=${encodeURIComponent(this.config.QB_MINOR_VERSION)}` : "";
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.headers as Record<string, string> | undefined)
    };
    const response = await fetch(`${this.config.QB_BASE_URL}/company/${this.config.QB_REALM_ID}/${path}${minor}`, {
      ...init,
      headers
    });
    if (!response.ok) {
      throw new Error(await qboErrorMessage(response, "QuickBooks request failed"));
    }
    const body = await response.text();
    if (!body.trim()) return {};
    return JSON.parse(body) as unknown;
  }

  async findOrCreateCustomer(input: QuickBooksCustomerInput): Promise<string> {
    const query = `select * from Customer where PrimaryEmailAddr = '${qboEscape(input.email)}' maxresults 1`;
    const result = customerQuerySchema.parse(await this.request(`query?query=${encodeURIComponent(query)}`));
    const existing = result.QueryResponse.Customer?.[0];
    if (existing) return existing.Id;
    const created = customerSchema.parse(await this.request("customer", {
      method: "POST", headers: { "request-id": input.requestId },
      body: JSON.stringify({ DisplayName: input.displayName.slice(0, 100), PrimaryEmailAddr: { Address: input.email }, PrimaryPhone: { FreeFormNumber: input.phone } })
    }));
    return created.Customer.Id;
  }

  async createInvoice(input: QuickBooksInvoiceInput): Promise<QuickBooksInvoice> {
    const result = invoiceSchema.parse(await this.request("invoice", {
      method: "POST", headers: { "request-id": input.requestId },
      body: JSON.stringify({
        CustomerRef: { value: input.customerId }, BillEmail: { Address: input.email },
        AllowOnlinePayment: true,
        AllowOnlineCreditCardPayment: true,
        AllowOnlineACHPayment: true,
        Line: [{ Amount: input.amount, DetailType: "SalesItemLineDetail", Description: input.description,
          SalesItemLineDetail: { ItemRef: { value: this.config.QB_SERVICE_ITEM_ID_TAX_ASSESSMENT }, Qty: 1, UnitPrice: input.amount } }]
      })
    }));
    return { id: result.Invoice.Id, number: result.Invoice.DocNumber, balance: result.Invoice.Balance ?? input.amount };
  }

  async sendInvoice(invoiceId: string, email: string, requestId: string): Promise<void> {
    const current = invoicePaymentSettingsSchema.parse(
      await this.request(`invoice/${encodeURIComponent(invoiceId)}`, { method: "GET" })
    ).Invoice;
    const onlinePaymentEnabled =
      current.AllowOnlinePayment === true &&
      current.AllowOnlineCreditCardPayment === true &&
      current.AllowOnlineACHPayment === true;

    if (!onlinePaymentEnabled) {
      await this.request("invoice", {
        method: "POST",
        headers: { "request-id": `${requestId.slice(0, 28)}-enable-online-payment` },
        body: JSON.stringify({
          sparse: true,
          Id: current.Id,
          SyncToken: current.SyncToken,
          AllowOnlinePayment: true,
          AllowOnlineCreditCardPayment: true,
          AllowOnlineACHPayment: true
        })
      });
    }

    await this.request(`invoice/${encodeURIComponent(invoiceId)}/send?sendTo=${encodeURIComponent(email)}`, { method: "POST", headers: { "request-id": requestId } });
  }

  async getInvoice(invoiceId: string): Promise<QuickBooksInvoiceStatus> {
    const result = invoiceLookupSchema.parse(await this.request(`invoice/${encodeURIComponent(invoiceId)}`, { method: "GET" }));
    return {
      id: result.Invoice.Id,
      number: result.Invoice.DocNumber,
      balance: result.Invoice.Balance ?? 0,
      totalAmount: result.Invoice.TotalAmt,
      currency: result.Invoice.CurrencyRef?.value
    };
  }
}
