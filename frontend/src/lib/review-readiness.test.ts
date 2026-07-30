import { describe, expect, it } from "vitest";
import {
  getNavigationRequirementIssue,
  getReviewSubmissionIssues,
  type ReviewReadinessState
} from "./review-readiness";

const readyState: ReviewReadinessState = {
  homeowner: false,
  ownsRealEstate: false,
  ownsBusiness: false,
  propertyCount: 0,
  businessCount: 0,
  uploadedCategories: ["TAX_RETURNS", "W2_INCOME"]
};

describe("review readiness", () => {
  it.each([
    { homeowner: true, ownsRealEstate: false },
    { homeowner: false, ownsRealEstate: true },
    { homeowner: true, ownsRealEstate: true }
  ])(
    "requires a real estate record for ownership state %#",
    ({ homeowner, ownsRealEstate }) => {
      const issues = getReviewSubmissionIssues({
        ...readyState,
        homeowner,
        ownsRealEstate
      });

      expect(issues).toEqual([
        expect.objectContaining({
          path: "Real Estate Intake",
          section: "realEstate"
        })
      ]);
    }
  );

  it("accepts either ownership flag when a real estate record exists", () => {
    expect(
      getReviewSubmissionIssues({
        ...readyState,
        homeowner: true,
        ownsRealEstate: true,
        propertyCount: 1
      })
    ).toEqual([]);
  });

  it("requires a business record only when business ownership is Yes", () => {
    expect(
      getReviewSubmissionIssues({
        ...readyState,
        ownsBusiness: true
      })
    ).toEqual([
      expect.objectContaining({
        path: "Business and Entity Intake",
        section: "business"
      })
    ]);
    expect(
      getReviewSubmissionIssues({
        ...readyState,
        ownsBusiness: true,
        businessCount: 1
      })
    ).toEqual([]);
  });

  it("requires both mandatory document categories for submission", () => {
    const issues = getReviewSubmissionIssues({
      ...readyState,
      uploadedCategories: []
    });

    expect(issues.map((issue) => issue.message)).toEqual([
      "Upload at least one Prior Tax Returns document.",
      "Upload at least one W-2 Income document."
    ]);
  });

  it("does not treat unanswered ownership questions as No", () => {
    const issues = getReviewSubmissionIssues({
      ...readyState,
      homeowner: null,
      ownsRealEstate: null,
      ownsBusiness: null
    });

    expect(issues.map((issue) => issue.message)).toEqual([
      "Select Yes or No for Homeowner.",
      "Select Yes or No for Own Real Estate.",
      "Select Yes or No for Own A Business."
    ]);
  });

  it("blocks only forward navigation beyond an incomplete required intake", () => {
    const missingRealEstate = {
      ...readyState,
      homeowner: true
    };
    const missingBusiness = {
      ...readyState,
      ownsBusiness: true
    };

    expect(getNavigationRequirementIssue("realEstate", missingRealEstate)).toBeUndefined();
    expect(getNavigationRequirementIssue("business", missingRealEstate)?.section).toBe(
      "realEstate"
    );
    expect(getNavigationRequirementIssue("documents", missingRealEstate)?.section).toBe(
      "realEstate"
    );
    expect(getNavigationRequirementIssue("business", missingBusiness)).toBeUndefined();
    expect(getNavigationRequirementIssue("documents", missingBusiness)?.section).toBe(
      "business"
    );
  });
});
