import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplicationSecrets } from "../../shared/application-secrets";
import { IntuitQuickBooksGateway } from "./quickbooks-client";

const secrets: ApplicationSecrets = {
  DATABASE_URL: "postgresql://example", EMAIL_ENABLED: false, EMAIL_FROM: "contactus@savians.com", EMAIL_REPLY_TO: "contactus@savians.com",
  QB_ENVIRONMENT: "sandbox", QB_CLIENT_ID: "client", QB_CLIENT_SECRET: "secret", QB_REFRESH_TOKEN: "refresh-old",
  QB_REALM_ID: "realm", QB_SERVICE_ITEM_ID_TAX_ASSESSMENT: "item-1", QB_BASE_URL: "https://sandbox-quickbooks.api.intuit.com/v3"
};
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("IntuitQuickBooksGateway", () => {
  it("rotates OAuth, reuses an existing email-matched customer, and creates the configured single-line invoice", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access", refresh_token: "refresh-new", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ QueryResponse: { Customer: [{ Id: "customer-1" }] } }))
      .mockResolvedValueOnce(response({ Invoice: { Id: "invoice-1", DocNumber: "1001", Balance: 2997 } }))
      .mockResolvedValueOnce(response({ Invoice: { Id: "invoice-1" } }));
    vi.stubGlobal("fetch", fetchMock); const persist = vi.fn().mockResolvedValue(undefined);
    const gateway = new IntuitQuickBooksGateway(secrets, persist);
    const customerId = await gateway.findOrCreateCustomer({ displayName: "Jane Client", email: "jane@example.com", phone: "+19185550123", requestId: "customer-request" });
    const invoice = await gateway.createInvoice({ customerId, email: "jane@example.com", amount: 2997, requestId: "invoice-request", description: "Savians Tax Assessment 2026" });
    await gateway.sendInvoice(invoice.id, "jane@example.com", "send-request");
    expect(customerId).toBe("customer-1"); expect(invoice).toEqual({ id: "invoice-1", number: "1001", balance: 2997 });
    expect(persist).toHaveBeenCalledWith("refresh-old", "refresh-new");
    const invoiceRequest = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(invoiceRequest[1].headers).toMatchObject({ "request-id": "invoice-request" });
    expect(JSON.parse(invoiceRequest[1].body as string)).toMatchObject({ CustomerRef: { value: "customer-1" }, Line: [{ Amount: 2997, SalesItemLineDetail: { ItemRef: { value: "item-1" }, Qty: 1, UnitPrice: 2997 } }] });
    const sendRequest = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(sendRequest[0]).toContain("invoice/invoice-1/send?sendTo=jane%40example.com");
    expect(sendRequest[1].headers).toMatchObject({ "request-id": "send-request" });
    expect(sendRequest[1].body).toBeUndefined();
  });

  it("creates a customer only when the normalized email is absent", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access", refresh_token: "refresh-new", expires_in: 3600 }))
      .mockResolvedValueOnce(response({ QueryResponse: {} }))
      .mockResolvedValueOnce(response({ Customer: { Id: "customer-new" } }));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new IntuitQuickBooksGateway(secrets, async () => undefined);
    expect(await gateway.findOrCreateCustomer({ displayName: "Jane Client", email: "jane@example.com", phone: "+19185550123", requestId: "customer-request" })).toBe("customer-new");
    expect((fetchMock.mock.calls[2] as [string, RequestInit])[1].headers).toMatchObject({ "request-id": "customer-request" });
  });
});
