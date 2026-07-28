import { describe, expect, it } from "vitest";
import {
  generatedPropertyLabel,
  normalizePortalPropertyCategory,
  portalPropertyCategoryOptions,
  preparePortalPropertiesForSave
} from "./portal-properties";

describe("portal property presentation", () => {
  it("exposes the exact client-facing property category choices", () => {
    expect(portalPropertyCategoryOptions).toEqual([
      "Primary Residence",
      "Secondary / Vacation Residence",
      "Rental",
      "Short-Term Rental / Airbnb",
      "Leased Apartment / Temporary Housing",
      "Other"
    ]);
  });

  it("normalizes legacy property data without overriding the user's former type selection", () => {
    expect(normalizePortalPropertyCategory("Rental", "Residential")).toBe("Rental");
    expect(normalizePortalPropertyCategory("PRIMARY_HOME", "Rental")).toBe("Rental");
    expect(normalizePortalPropertyCategory("PRIMARY_HOME", "Residential")).toBe("Primary Residence");
    expect(normalizePortalPropertyCategory("PRIMARY_HOME")).toBe("Primary Residence");
    expect(normalizePortalPropertyCategory("Unrecognized legacy value")).toBe("Other");
    expect(generatedPropertyLabel(1)).toBe("Property 2");
    expect(preparePortalPropertiesForSave([
      { category: "PRIMARY_HOME", label: "Lake house", propertyType: "Residential", address: "1 Lake Road" },
      { category: "PRIMARY_HOME", label: "", propertyType: "Rental", address: "2 Main Street" }
    ])).toEqual([
      { category: "Primary Residence", label: "Property 1", propertyType: "Primary Residence", address: "1 Lake Road" },
      { category: "Rental", label: "Property 2", propertyType: "Rental", address: "2 Main Street" }
    ]);
  });
});
