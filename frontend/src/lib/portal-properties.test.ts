import { describe, expect, it } from "vitest";
import {
  generatedPropertyLabel,
  normalizePortalPropertyType,
  portalPropertyTypeOptions,
  preparePortalPropertiesForSave
} from "./portal-properties";

describe("portal property presentation", () => {
  it("exposes the exact client-facing property type choices", () => {
    expect(portalPropertyTypeOptions).toEqual([
      "Primary Residence",
      "Secondary / Vacation Residence",
      "Rental",
      "Short-Term Rental / Airbnb",
      "Leased Apartment / Temporary Housing",
      "Other"
    ]);
  });

  it("normalizes legacy property types and generates stable ordinal labels", () => {
    expect(normalizePortalPropertyType("Residential")).toBe("Primary Residence");
    expect(normalizePortalPropertyType("Unrecognized legacy value")).toBe("Other");
    expect(generatedPropertyLabel(1)).toBe("Property 2");
    expect(preparePortalPropertiesForSave([
      { label: "Lake house", propertyType: "Residential", address: "1 Lake Road" },
      { label: "", propertyType: "Rental", address: "2 Main Street" }
    ])).toEqual([
      { label: "Property 1", propertyType: "Primary Residence", address: "1 Lake Road" },
      { label: "Property 2", propertyType: "Rental", address: "2 Main Street" }
    ]);
  });
});
