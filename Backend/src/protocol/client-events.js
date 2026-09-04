const { z } = require("zod");

const requestIdSchema = z.string().uuid();

const chatRequestSchema = z
  .object({
    type: z.literal("chat.request"),
    requestId: requestIdSchema,
    message: z.string().trim().min(1),
    region: z.string().trim().min(1).nullable().default(null),
  })
  .strict();

const chatCancelSchema = z
  .object({
    type: z.literal("chat.cancel"),
    requestId: requestIdSchema,
  })
  .strict();

const chatClearSchema = z
  .object({
    type: z.literal("chat.clear"),
  })
  .strict();

const clientEventSchema = z.discriminatedUnion("type", [
  chatRequestSchema,
  chatCancelSchema,
  chatClearSchema,
]);

function parseClientEvent(payload) {
  const decoded = typeof payload === "string" ? JSON.parse(payload) : payload;
  return clientEventSchema.parse(decoded);
}

module.exports = {
  chatCancelSchema,
  chatClearSchema,
  chatRequestSchema,
  clientEventSchema,
  parseClientEvent,
};
