import type { ScheduledHandler } from "aws-lambda";
import { log } from "../shared/logger";
import { getRuntimeConfig } from "../shared/runtime-config";

export const handler: ScheduledHandler = (event, context) => {
  const config = getRuntimeConfig();
  log("info", "assessment scheduled foundation invoked", {
    requestId: context.awsRequestId,
    service: config.SERVICE_NAME,
    eventId: event.id
  });
};
