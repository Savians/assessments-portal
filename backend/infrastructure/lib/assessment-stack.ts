import path from "node:path";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as cr from "aws-cdk-lib/custom-resources";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export interface AssessmentStackProps extends StackProps {
  environmentName: "development" | "staging" | "production";
  frontendUrl: string;
  vpcId: string;
  privateSubnetIds: [string, string];
  lambdaSecurityGroupId: string;
  cognitoUserPoolId: string;
  documentsBucketName: string;
  kmsKeyId?: string;
  assessmentSecretName: string;
}

type ServiceName =
  | "public"
  | "agreement"
  | "quickbooks"
  | "payment"
  | "auth"
  | "admin"
  | "portal"
  | "documents"
  | "notifications"
  | "webhook"
  | "scheduler";

interface RouteDefinition {
  service: ServiceName;
  method: apigwv2.HttpMethod;
  path: string;
  authenticated: boolean;
}

const routes: RouteDefinition[] = [
  { service: "public", method: apigwv2.HttpMethod.GET, path: "/api/assessment/health", authenticated: false },
  { service: "public", method: apigwv2.HttpMethod.POST, path: "/api/assessment/start", authenticated: false },
  { service: "public", method: apigwv2.HttpMethod.POST, path: "/api/assessment/recover", authenticated: false },
  { service: "agreement", method: apigwv2.HttpMethod.GET, path: "/api/assessment/agreement/{token}", authenticated: false },
  { service: "agreement", method: apigwv2.HttpMethod.POST, path: "/api/assessment/agreement/sign", authenticated: false },
  { service: "payment", method: apigwv2.HttpMethod.GET, path: "/api/assessment/status/{token}", authenticated: false },
  { service: "payment", method: apigwv2.HttpMethod.POST, path: "/api/assessment/refresh-payment-status", authenticated: false },
  { service: "payment", method: apigwv2.HttpMethod.POST, path: "/api/assessment/resend-invoice-email", authenticated: false },
  { service: "payment", method: apigwv2.HttpMethod.POST, path: "/api/assessment/payment-support", authenticated: false },
  { service: "auth", method: apigwv2.HttpMethod.POST, path: "/api/assessment/account/invite/validate", authenticated: false },
  { service: "auth", method: apigwv2.HttpMethod.POST, path: "/api/assessment/account/invite/reissue", authenticated: false },
  { service: "auth", method: apigwv2.HttpMethod.POST, path: "/api/assessment/account/invite/start", authenticated: false },
  { service: "auth", method: apigwv2.HttpMethod.POST, path: "/api/assessment/account/setup", authenticated: false },
  { service: "auth", method: apigwv2.HttpMethod.POST, path: "/api/assessment/account/verification/resend", authenticated: false },
  { service: "auth", method: apigwv2.HttpMethod.POST, path: "/api/assessment/account/confirm", authenticated: false },
  { service: "auth", method: apigwv2.HttpMethod.POST, path: "/api/assessment/account/password-reset/request", authenticated: false },
  { service: "auth", method: apigwv2.HttpMethod.POST, path: "/api/assessment/account/password-reset/confirm", authenticated: false },
  { service: "auth", method: apigwv2.HttpMethod.POST, path: "/api/assessment/account/existing/claim", authenticated: true },
  { service: "admin", method: apigwv2.HttpMethod.GET, path: "/api/assessment/admin/overview", authenticated: true },
  { service: "admin", method: apigwv2.HttpMethod.GET, path: "/api/assessment/admin/clients", authenticated: true },
  { service: "admin", method: apigwv2.HttpMethod.GET, path: "/api/assessment/admin/clients/{sessionId}", authenticated: true },
  { service: "admin", method: apigwv2.HttpMethod.PUT, path: "/api/assessment/admin/clients/{sessionId}/identity", authenticated: true },
  { service: "admin", method: apigwv2.HttpMethod.PUT, path: "/api/assessment/admin/clients/{sessionId}/profile", authenticated: true },
  { service: "admin", method: apigwv2.HttpMethod.PUT, path: "/api/assessment/admin/clients/{sessionId}/properties", authenticated: true },
  { service: "admin", method: apigwv2.HttpMethod.PUT, path: "/api/assessment/admin/clients/{sessionId}/business-investments", authenticated: true },
  { service: "admin", method: apigwv2.HttpMethod.PUT, path: "/api/assessment/admin/clients/{sessionId}/status", authenticated: true },
  { service: "admin", method: apigwv2.HttpMethod.GET, path: "/api/assessment/admin/documents", authenticated: true },
  { service: "admin", method: apigwv2.HttpMethod.GET, path: "/api/assessment/admin/documents/{documentId}/preview-url", authenticated: true },
  { service: "portal", method: apigwv2.HttpMethod.GET, path: "/api/assessment/portal/dashboard", authenticated: true },
  { service: "portal", method: apigwv2.HttpMethod.GET, path: "/api/assessment/portal/profile", authenticated: true },
  { service: "portal", method: apigwv2.HttpMethod.POST, path: "/api/assessment/portal/profile", authenticated: true },
  { service: "portal", method: apigwv2.HttpMethod.POST, path: "/api/assessment/portal/properties", authenticated: true },
  { service: "portal", method: apigwv2.HttpMethod.POST, path: "/api/assessment/portal/business-investments", authenticated: true },
  { service: "portal", method: apigwv2.HttpMethod.POST, path: "/api/assessment/portal/ready-for-review", authenticated: true },
  { service: "documents", method: apigwv2.HttpMethod.GET, path: "/api/assessment/documents", authenticated: true },
  { service: "documents", method: apigwv2.HttpMethod.POST, path: "/api/assessment/documents/upload-url", authenticated: true },
  { service: "documents", method: apigwv2.HttpMethod.POST, path: "/api/assessment/documents/complete", authenticated: true },
  { service: "documents", method: apigwv2.HttpMethod.GET, path: "/api/assessment/documents/{documentId}/preview-url", authenticated: true },
  { service: "documents", method: apigwv2.HttpMethod.DELETE, path: "/api/assessment/documents/{documentId}", authenticated: true },
  { service: "webhook", method: apigwv2.HttpMethod.POST, path: "/api/assessment/webhooks/quickbooks", authenticated: false }
];

const services: ServiceName[] = [
  "public", "agreement", "quickbooks", "payment", "auth", "admin",
  "portal", "documents", "notifications", "webhook", "scheduler"
];

const copyPrismaRuntimeCommand = (inputDir: string, outputDir: string): string => {
  const script =
    "const fs=require('fs');" +
    "const path=require('path');" +
    "const pairs=[['node_modules','.prisma'],['node_modules','@prisma']];" +
    "for(const parts of pairs){" +
    "const src=path.join(process.argv[1],...parts);" +
    "const dest=path.join(process.argv[2],...parts);" +
    "if(fs.existsSync(src)){" +
    "fs.mkdirSync(path.dirname(dest),{recursive:true});" +
    "fs.cpSync(src,dest,{recursive:true});" +
    "}" +
    "}";
  return "node -e " + JSON.stringify(script) + " " + JSON.stringify(inputDir) + " " + JSON.stringify(outputDir);
};

export class AssessmentStack extends Stack {
  constructor(scope: Construct, id: string, props: AssessmentStackProps) {
    super(scope, id, props);

    Tags.of(this).add("Project", "savians-assessments");
    Tags.of(this).add("Environment", props.environmentName);
    Tags.of(this).add("ManagedBy", "cdk");

    const vpc = ec2.Vpc.fromVpcAttributes(this, "ExistingVpc", {
      vpcId: props.vpcId,
      availabilityZones: [this.region + "a", this.region + "b"],
      privateSubnetIds: props.privateSubnetIds
    });
    const subnets = props.privateSubnetIds.map((subnetId, index) =>
      ec2.Subnet.fromSubnetId(this, "PrivateSubnet" + (index + 1), subnetId)
    );
    const lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "ExistingLambdaSecurityGroup",
      props.lambdaSecurityGroupId,
      { mutable: false }
    );

    const userPool = cognito.UserPool.fromUserPoolId(
      this,
      "ExistingUserPool",
      props.cognitoUserPoolId
    );
    const appClient = new cognito.UserPoolClient(this, "AssessmentAppClient", {
      userPool,
      userPoolClientName: "savians-assessment-" + props.environmentName,
      generateSecret: false,
      preventUserExistenceErrors: true,
      authFlows: { userSrp: true },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      disableOAuth: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30)
    });
    if (props.environmentName !== "production") {
      new cognito.CfnUserPoolGroup(this, "AssessmentClientGroup", {
        userPoolId: userPool.userPoolId,
        groupName: "ASSESSMENT_CLIENT",
        description: "Paid Savians Tax Assessment clients"
      });
    }

    const documentsBucket = s3.Bucket.fromBucketName(
      this,
      "ExistingDocumentsBucket",
      props.documentsBucketName
    );
    const documentUploadCorsOrigins = Array.from(new Set([
      props.frontendUrl,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://*.savians.com"
    ]));
    const documentUploadCorsCall = {
      service: "S3",
      action: "putBucketCors",
      parameters: {
        Bucket: props.documentsBucketName,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ["*"],
              AllowedMethods: ["GET", "HEAD", "PUT"],
              AllowedOrigins: documentUploadCorsOrigins,
              ExposeHeaders: [
                "ETag",
                "x-amz-request-id",
                "x-amz-id-2",
                "x-amz-checksum-crc32"
              ],
              MaxAgeSeconds: 3000
            }
          ]
        }
      },
      physicalResourceId: cr.PhysicalResourceId.of(
        "assessment-document-upload-cors-" + props.environmentName
      )
    };
    new cr.AwsCustomResource(this, "AssessmentDocumentUploadBucketCors", {
      onCreate: documentUploadCorsCall,
      onUpdate: documentUploadCorsCall,
      installLatestAwsSdk: false,
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ["s3:GetBucketCORS", "s3:PutBucketCORS"],
          resources: [documentsBucket.bucketArn]
        })
      ])
    });
    const encryptionKey = props.kmsKeyId
      ? kms.Key.fromKeyArn(
          this,
          "ExistingKmsKey",
          Stack.of(this).formatArn({
            service: "kms",
            resource: "key",
            resourceName: props.kmsKeyId
          })
        )
      : props.environmentName === "production"
        ? new kms.Key(this, "AssessmentProductionKey", {
            alias: "alias/savians-assessment-production",
            description: "Encrypts Savians Assessments production Lambda configuration and application data",
            enableKeyRotation: true,
            removalPolicy: RemovalPolicy.RETAIN
          })
        : undefined;
    const applicationSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AssessmentApplicationSecret",
      props.assessmentSecretName
    );

    const functions = new Map<ServiceName, NodejsFunction>();
    for (const service of services) {
      const fn = new NodejsFunction(this, service + "Function", {
        functionName: "savians-assessment-" + props.environmentName + "-" + service,
        description: "Savians Assessments " + service + " service",
        entry: path.join(
          __dirname,
          service === "public"
              ? "../../src/services/public/handler.ts"
              : service === "agreement"
                ? "../../src/services/agreement/handler.ts"
                : service === "payment"
                  ? "../../src/services/payment/handler.ts"
                  : service === "auth"
                    ? "../../src/services/auth/handler.ts"
                    : service === "portal"
                      ? "../../src/services/portal/handler.ts"
                      : service === "admin"
                        ? "../../src/services/admin/handler.ts"
                      : service === "documents"
                        ? "../../src/services/documents/handler.ts"
                  : service === "webhook"
                    ? "../../src/services/webhook/handler.ts"
                    : service === "scheduler"
                      ? "../../src/services/scheduler/handler.ts"
                      : "../../src/handlers/http.ts"
        ),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: service === "portal" || service === "documents" || service === "admin" ? 1024 : 512,
        timeout: service === "webhook" ? Duration.seconds(15) : Duration.seconds(30),
        tracing: lambda.Tracing.ACTIVE,
        vpc,
        vpcSubnets: { subnets },
        securityGroups: [lambdaSecurityGroup],
        environmentEncryption: encryptionKey,
        environment: {
          NODE_ENV: props.environmentName,
          ENVIRONMENT: props.environmentName,
          SERVICE_NAME: service,
          LOG_LEVEL: props.environmentName === "production" ? "info" : "debug",
          ASSESSMENT_SECRET_NAME: props.assessmentSecretName,
          FRONTEND_URL: props.frontendUrl,
          TABLE_PREFIX: "assessment_",
          S3_PREFIX: "assessments/",
          S3_DOCUMENTS_BUCKET: props.documentsBucketName,
          COGNITO_USER_POOL_ID: userPool.userPoolId,
          COGNITO_CLIENT_ID: appClient.userPoolClientId
        },
        bundling: {
          minify: props.environmentName === "production",
          sourceMap: true,
          target: "node20",
          commandHooks: {
            beforeBundling: () => [],
            beforeInstall: () => [],
            afterBundling: (inputDir, outputDir) => [
              copyPrismaRuntimeCommand(inputDir, outputDir)
            ]
          }
        }
      });
      // Lambda code is stateless. Retaining production functions after a failed
      // stack create leaves their fixed names orphaned and prevents a clean retry.
      fn.applyRemovalPolicy(
        props.environmentName === "production" ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN
      );
      applicationSecret.grantRead(fn);
      if (["agreement", "payment", "webhook", "scheduler"].includes(service)) applicationSecret.grantWrite(fn);
      if (service === "agreement") {
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: [documentsBucket.arnForObjects("assessments/legal/templates/*")] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:PutObject"], resources: [documentsBucket.arnForObjects(`assessments/${props.environmentName}/legal-evidence/*`)] }));
      }
      if (service === "documents") {
        fn.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
            resources: [documentsBucket.arnForObjects("assessments/*")]
          })
        );
        fn.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ["s3:ListBucket"],
            resources: [documentsBucket.bucketArn],
            conditions: { StringLike: { "s3:prefix": ["assessments/*"] } }
          })
        );
      }
      if (service === "admin") {
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: [documentsBucket.arnForObjects("assessments/*")] }));
        fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["cognito-idp:AdminUpdateUserAttributes"], resources: [userPool.userPoolArn] }));
      }
      if (service === "auth") {
        fn.addToRolePolicy(new iam.PolicyStatement({
          actions: [
            "cognito-idp:AdminAddUserToGroup",
            "cognito-idp:AdminCreateUser",
            "cognito-idp:AdminGetUser",
            "cognito-idp:AdminSetUserPassword",
            "cognito-idp:AdminUpdateUserAttributes"
          ],
          resources: [userPool.userPoolArn]
        }));
      }
      encryptionKey?.grantEncryptDecrypt(fn);
      functions.set(service, fn);
    }

    const httpApi = new apigwv2.HttpApi(this, "AssessmentHttpApi", {
      apiName: "savians-assessment-" + props.environmentName + "-api",
      description: "Savians Tax Assessment API",
      corsPreflight: {
        allowOrigins: Array.from(new Set([props.frontendUrl, "http://localhost:3000"])),
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS
        ],
        allowHeaders: ["content-type", "authorization", "x-request-id"],
        allowCredentials: true,
        maxAge: Duration.hours(1)
      }
    });

    const authorizer = new HttpJwtAuthorizer(
      "AssessmentCognitoAuthorizer",
      "https://cognito-idp." + this.region + ".amazonaws.com/" + userPool.userPoolId,
      {
        jwtAudience: [appClient.userPoolClientId],
        authorizerName: "savians-assessment-" + props.environmentName + "-authorizer"
      }
    );

    for (const route of routes) {
      const fn = functions.get(route.service);
      if (!fn) throw new Error("Missing Lambda for " + route.service);
      httpApi.addRoutes({
        path: route.path,
        methods: [route.method],
        integration: new HttpLambdaIntegration(
          route.service + "-" + route.method + "-integration",
          fn
        ),
        authorizer: route.authenticated ? authorizer : undefined
      });
    }

    const scheduler = functions.get("scheduler");
    if (!scheduler) throw new Error("Missing scheduler Lambda");
    const reconciliationRule = new events.Rule(this, "PaymentReconciliationSchedule", {
      ruleName: "savians-assessment-" + props.environmentName + "-payment-reconciliation",
      description: "Backup reconciliation for open QuickBooks assessment invoices",
      schedule: events.Schedule.rate(Duration.minutes(15)),
      enabled: props.environmentName === "production"
    });
    reconciliationRule.addTarget(new targets.LambdaFunction(scheduler));

    new CfnOutput(this, "ApiEndpoint", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "ApiId", { value: httpApi.apiId });
    new CfnOutput(this, "CognitoAppClientId", { value: appClient.userPoolClientId });
    new CfnOutput(this, "QuickBooksWebhookUrl", {
      value: httpApi.apiEndpoint + "/api/assessment/webhooks/quickbooks"
    });
  }
}
