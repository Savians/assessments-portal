ALTER TABLE "assessment_client_profiles"
  ADD COLUMN "last_year_taxable_income" DECIMAL(14, 2),
  ADD COLUMN "projected_taxable_income" DECIMAL(14, 2),
  ADD COLUMN "life_insurance_in_place" BOOLEAN,
  ADD COLUMN "estate_planning_in_place" BOOLEAN,
  ADD COLUMN "major_purchase_notes" TEXT;

ALTER TABLE "assessment_business_investments"
  ADD COLUMN "income_loss_year_minus_3" DECIMAL(14, 2),
  ADD COLUMN "income_loss_year_minus_2" DECIMAL(14, 2),
  ADD COLUMN "income_loss_year_minus_1" DECIMAL(14, 2),
  ADD COLUMN "projected_current_year_income_loss" DECIMAL(14, 2),
  ADD COLUMN "active" BOOLEAN DEFAULT TRUE;
