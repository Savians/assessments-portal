import type { DocumentCategory } from "@/services/assessment-api";

export type IntakeSection = "personal" | "realEstate" | "business" | "documents";

export interface ReviewReadinessState {
  homeowner: boolean | null;
  ownsRealEstate: boolean | null;
  ownsBusiness: boolean | null;
  propertyCount: number;
  businessCount: number;
  uploadedCategories: readonly DocumentCategory[];
}

export interface ReviewReadinessIssue {
  path: string;
  message: string;
  section: IntakeSection;
}

export const requiredReviewDocuments = [
  {
    category: "TAX_RETURNS",
    label: "Prior Tax Returns document"
  },
  {
    category: "W2_INCOME",
    label: "W-2 Income document"
  }
] as const satisfies ReadonlyArray<{ category: DocumentCategory; label: string }>;

const sectionOrder: Record<IntakeSection, number> = {
  personal: 0,
  realEstate: 1,
  business: 2,
  documents: 3
};

export function isRequiredReviewDocument(category: DocumentCategory) {
  return requiredReviewDocuments.some((document) => document.category === category);
}

export function getRecordRequirementIssues(
  state: Pick<
    ReviewReadinessState,
    | "homeowner"
    | "ownsRealEstate"
    | "ownsBusiness"
    | "propertyCount"
    | "businessCount"
  >
): ReviewReadinessIssue[] {
  const issues: ReviewReadinessIssue[] = [];

  if (state.homeowner === null) {
    issues.push({
      path: "Personal and Family Information",
      message: "Select Yes or No for Homeowner.",
      section: "personal"
    });
  }

  if (state.ownsRealEstate === null) {
    issues.push({
      path: "Personal and Family Information",
      message: "Select Yes or No for Own Real Estate.",
      section: "personal"
    });
  }

  if (state.ownsBusiness === null) {
    issues.push({
      path: "Personal and Family Information",
      message: "Select Yes or No for Own A Business.",
      section: "personal"
    });
  }

  if (
    (state.homeowner === true || state.ownsRealEstate === true) &&
    state.propertyCount === 0
  ) {
    issues.push({
      path: "Real Estate Intake",
      message:
        "Add at least one real estate record because Homeowner? or Own Real Estate? is set to Yes.",
      section: "realEstate"
    });
  }

  if (state.ownsBusiness === true && state.businessCount === 0) {
    issues.push({
      path: "Business and Entity Intake",
      message:
        "Add at least one business or entity record because Own A Business? is set to Yes.",
      section: "business"
    });
  }

  return issues;
}

export function getNavigationRequirementIssue(
  nextSection: IntakeSection,
  state: ReviewReadinessState
) {
  return getRecordRequirementIssues(state).find(
    (issue) => sectionOrder[nextSection] > sectionOrder[issue.section]
  );
}

export function getReviewSubmissionIssues(
  state: ReviewReadinessState
): ReviewReadinessIssue[] {
  const issues = getRecordRequirementIssues(state);
  const uploadedCategories = new Set(state.uploadedCategories);

  for (const document of requiredReviewDocuments) {
    if (!uploadedCategories.has(document.category)) {
      issues.push({
        path: "Document Upload Requirements",
        message: `Upload at least one ${document.label}.`,
        section: "documents"
      });
    }
  }

  return issues;
}
