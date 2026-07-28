export const portalPropertyCategoryOptions = [
  "Primary Residence",
  "Secondary / Vacation Residence",
  "Rental",
  "Short-Term Rental / Airbnb",
  "Leased Apartment / Temporary Housing",
  "Other"
] as const;

export type PortalPropertyCategory = (typeof portalPropertyCategoryOptions)[number];

const legacyPropertyCategoryAliases: Record<string, PortalPropertyCategory> = {
  PRIMARY_HOME: "Primary Residence",
  PRIMARY_RESIDENCE: "Primary Residence",
  SECONDARY_HOME: "Secondary / Vacation Residence",
  VACATION_HOME: "Secondary / Vacation Residence",
  RENTAL: "Rental",
  SHORT_TERM_RENTAL: "Short-Term Rental / Airbnb",
  LEASED_APARTMENT: "Leased Apartment / Temporary Housing",
  Residential: "Primary Residence",
  "Primary Home": "Primary Residence",
  "Vacation Home": "Secondary / Vacation Residence",
  "Short-Term Rental": "Short-Term Rental / Airbnb",
  Airbnb: "Short-Term Rental / Airbnb",
  "Leased Apartment": "Leased Apartment / Temporary Housing"
};

export function normalizePortalPropertyCategory(category: string, legacyPropertyType = ""): PortalPropertyCategory {
  if ((portalPropertyCategoryOptions as readonly string[]).includes(category)) {
    return category as PortalPropertyCategory;
  }

  if ((portalPropertyCategoryOptions as readonly string[]).includes(legacyPropertyType)) {
    return legacyPropertyType as PortalPropertyCategory;
  }

  return legacyPropertyCategoryAliases[legacyPropertyType]
    ?? legacyPropertyCategoryAliases[category]
    ?? "Other";
}

export function generatedPropertyLabel(index: number) {
  return `Property ${index + 1}`;
}

export function preparePortalPropertiesForSave<T extends { category: string; label: string; propertyType: string }>(
  properties: T[]
): T[] {
  return properties.map((property, index) => {
    const category = normalizePortalPropertyCategory(property.category, property.propertyType);
    return {
      ...property,
      category,
      label: generatedPropertyLabel(index),
      propertyType: category
    };
  });
}
