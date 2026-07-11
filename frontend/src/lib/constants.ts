export const APP_NAME = "Savians Tax Assessment Portal";
export const SERVICE_NAME = "Savians Tax Assessment";
export const SERVICE_AMOUNT = 2_997;
export const SERVICE_CURRENCY = "USD";
export const PRODUCTION_DOMAIN = "assessments.savians.com";

export const formatServiceAmount = () =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: SERVICE_CURRENCY,
    maximumFractionDigits: 0
  }).format(SERVICE_AMOUNT);
