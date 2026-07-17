import { describe, expect, it } from "vitest";
import { buildClientSearchWhere } from "./admin-client-search";

describe("admin client search", () => {
  it("keeps email, phone, invoice, and individual name field searches", () => {
    const where = buildClientSearchWhere("client@example.com");
    expect(where.OR).toEqual(expect.arrayContaining([
      { normalizedEmail: { contains: "client@example.com", mode: "insensitive" } },
      { phone: { contains: "client@example.com" } },
      { qbInvoiceNumber: { contains: "client@example.com", mode: "insensitive" } }
    ]));
  });

  it("matches a visible full name across separately stored name columns", () => {
    const where = buildClientSearchWhere("Test User4");
    expect(where.OR).toContainEqual({
      AND: [
        { OR: expect.arrayContaining([{ firstName: { contains: "Test", mode: "insensitive" } }]) },
        { OR: expect.arrayContaining([{ lastName: { contains: "User4", mode: "insensitive" } }]) }
      ]
    });
  });

  it("normalizes surrounding and repeated whitespace", () => {
    const where = buildClientSearchWhere("  Jane   Mary Smith  ");
    const fullNameClause = (where.OR as object[]).find((clause) => "AND" in clause) as { AND: object[] };
    expect(fullNameClause.AND).toHaveLength(3);
  });
});
