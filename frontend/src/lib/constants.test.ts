import { describe, expect, it } from "vitest";
import {
  APP_NAME,
  PRODUCTION_DOMAIN,
  SERVICE_AMOUNT,
  formatServiceAmount
} from "./constants";

describe("assessment constants", () => {
  it("keeps product identity centralized", () => {
    expect(APP_NAME).toBe("Savians Tax Assessment Portal");
    expect(PRODUCTION_DOMAIN).toBe("assessments.savians.com");
    expect(SERVICE_AMOUNT).toBe(2997);
    expect(formatServiceAmount()).toBe("$2,997");
  });
});
