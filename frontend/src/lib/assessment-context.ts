export const clientTypeOptions = [
  { value: "INDIVIDUAL", label: "Individual" },
  { value: "BUSINESS_OWNER", label: "Business Owner" },
  { value: "REAL_ESTATE_INVESTOR", label: "Real Estate Investor" },
  { value: "W2_HIGH_EARNER", label: "W-2 High Earner" },
  { value: "OTHER", label: "Other" }
] as const;

export const incomeRangeOptions = [
  "$150K-$250K",
  "$250K-$500K",
  "$500K-$1M",
  "$1M+"
] as const;

export const taxPaidRangeOptions = [
  { value: "UNDER_$25K", label: "Under $25K" },
  { value: "$25K-$50K", label: "$25K-$50K" },
  { value: "$50K-$100K", label: "$50K-$100K" },
  { value: "$100K+", label: "$100K+" }
] as const;
