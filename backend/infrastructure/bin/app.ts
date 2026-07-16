#!/usr/bin/env node
import "dotenv/config";
import { App } from "aws-cdk-lib";
import { AssessmentStack } from "../lib/assessment-stack";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error("Missing required infrastructure variable: " + name);
  return value;
};

const environmentName = (process.env.DEPLOY_ENVIRONMENT ?? "staging") as
  | "development"
  | "staging"
  | "production";

if (!["development", "staging", "production"].includes(environmentName)) {
  throw new Error("DEPLOY_ENVIRONMENT must be development, staging, or production");
}

const configuredKmsKeyId = process.env.KMS_KEY_ID;
const kmsKeyId =
  configuredKmsKeyId &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    configuredKmsKeyId
  )
    ? configuredKmsKeyId
    : undefined;

const app = new App();

new AssessmentStack(app, "SaviansAssessment-" + environmentName, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? "us-east-1"
  },
  environmentName,
  frontendUrl:
    process.env.FRONTEND_URL ??
    (environmentName === "production"
      ? "https://assessments.savians.com"
      : "https://staging.assessments.savians.com"),
  vpcId: required("VPC_ID"),
  privateSubnetIds: [required("PVT_SUBNET1"), required("PVT_SUBNET2")],
  lambdaSecurityGroupId: required("LAMBDA_SG"),
  cognitoUserPoolId: required("COGNITO_USER_POOL_ID"),
  documentsBucketName: required("S3_DOCUMENTS_BUCKET"),
  kmsKeyId,
  assessmentSecretName:
    process.env.ASSESSMENT_SECRET_NAME ?? "savians/assessment/" + environmentName,
  description: "Savians Tax Assessment Portal " + environmentName + " infrastructure"
});
