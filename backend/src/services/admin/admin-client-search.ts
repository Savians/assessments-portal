import type { Prisma } from "@prisma/client";

const nameFields = (value: string): Prisma.AssessmentSessionWhereInput[] => [
  { firstName: { contains: value, mode: "insensitive" } },
  { middleName: { contains: value, mode: "insensitive" } },
  { lastName: { contains: value, mode: "insensitive" } }
];

/** Supports full visible names even though names are stored in separate columns. */
export function buildClientSearchWhere(search: string): Prisma.AssessmentSessionWhereInput {
  const normalized = search.trim();
  const nameTokens = normalized.split(/\s+/).filter(Boolean);

  return {
    OR: [
      ...nameFields(normalized),
      { normalizedEmail: { contains: normalized, mode: "insensitive" } },
      { phone: { contains: normalized } },
      { qbInvoiceNumber: { contains: normalized, mode: "insensitive" } },
      ...(nameTokens.length > 1
        ? [{ AND: nameTokens.map((token) => ({ OR: nameFields(token) })) }]
        : [])
    ]
  };
}
