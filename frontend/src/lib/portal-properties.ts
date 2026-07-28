export const portalPropertyTypeOptions = [
  "Primary Residence",
  "Secondary / Vacation Residence",
  "Rental",
  "Short-Term Rental / Airbnb",
  "Leased Apartment / Temporary Housing",
  "Other"
] as const;

export type PortalPropertyType = (typeof portalPropertyTypeOptions)[number];

const legacyPropertyTypeAliases: Record<string, PortalPropertyType> = {
  Residential: "Primary Residence",
  "Primary Home": "Primary Residence",
  "Vacation Home": "Secondary / Vacation Residence",
  "Short-Term Rental": "Short-Term Rental / Airbnb",
  Airbnb: "Short-Term Rental / Airbnb",
  "Leased Apartment": "Leased Apartment / Temporary Housing"
};

export function normalizePortalPropertyType(value: string): PortalPropertyType {
  if ((portalPropertyTypeOptions as readonly string[]).includes(value)) {
    return value as PortalPropertyType;
  }
  return legacyPropertyTypeAliases[value] ?? "Other";
}

export function generatedPropertyLabel(index: number) {
  return `Property ${index + 1}`;
}

export function preparePortalPropertiesForSave<T extends { label: string; propertyType: string }>(
  properties: T[]
): T[] {
  return properties.map((property, index) => ({
    ...property,
    label: generatedPropertyLabel(index),
    propertyType: normalizePortalPropertyType(property.propertyType)
  }));
}
