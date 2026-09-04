const { randomUUID } = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

const {
  classifyConversationalMessage,
} = require("../chat/conversational-intent");
const { ConversationStore } = require("../chat/conversation-store");
const { createLogger, previewText } = require("../config/logger");
const { parseClientEvent } = require("../protocol/client-events");

const EASTMAN_INQUIRY_URL =
  "https://www.eastman.com/en/contact-us/product-inquiry";
const HANDOFF_TEXT = `You’ve completed the three guided product questions available in this chat. The best next step is to connect with Eastman product support for application-specific guidance.

### Contact Eastman
- Use the official product inquiry form linked below.
- Include your application or end use, region, required performance, and anticipated volume.
- Mention any shortlisted product names or FGMNs so the sales and technical teams can respond efficiently.

Product recommendations must be validated by Eastman for your final formulation, process, regulatory, and supply requirements.`;
const HANDOFF_SOURCE = {
  id: "contact:eastman-product-inquiry",
  title: "Contact Eastman product support",
  url: EASTMAN_INQUIRY_URL,
};

function send(socket, event) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n${message}`);
  socket.destroy();
}

function validateEventLimits(event, config) {
  if (event.type !== "chat.request") return true;
  return event.message.length <= config.CHAT_MAX_MESSAGE_CHARS;
}

function classifyChatError(error) {
  return error?.name === "BedrockError" ? "model_error" : "chat_error";
}

function serializeResults(retrieval = { results: [] }) {
  const results = retrieval.results || [];
  const sources = [
    ...(retrieval.sources || []),
    ...results.flatMap((result) => result.sources || []),
  ]
    .filter((source) => source?.url && source?.title)
    .filter(
      (source, index, values) =>
        values.findIndex(
          (candidate) =>
            candidate.id === source.id || candidate.url === source.url,
        ) === index,
    );
  return {
    sources,
    products: results.map(({ product }) => ({
      fgmn: product.fgmn,
      displayName: product.displayName,
      documents: product.documents,
      links: product.links,
    })),
  };
}

function attachChatWebSocket({
  server,
  config,
  orchestrator,
  corpusVersion,
  conversationStore,
  logger = createLogger({ name: "websocket", level: config.LOG_LEVEL }),
}) {
  const conversations =
    conversationStore ||
    new ConversationStore({
      maxProductTurns: config.CHAT_MAX_PRODUCT_TURNS,
      maxHistoryTurns: config.CHAT_MAX_HISTORY_TURNS,
      maxHistoryChars: config.CHAT_MAX_HISTORY_CHARS,
    });
  const wsLogger = logger.child("websocket");
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: config.WS_MAX_PAYLOAD_BYTES,
  });

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url, "http://localhost");
    if (requestUrl.pathname !== "/ws/chat") {
      wsLogger.warn("ws.upgrade_rejected", {
        path: requestUrl.pathname,
        status: 404,
      });
      return rejectUpgrade(socket, "404 Not Found", "Not found");
    }
    if (request.headers.origin !== config.APP_ORIGIN) {
      wsLogger.warn("ws.upgrade_rejected", {
        origin: request.headers.origin || null,
        status: 403,
      });
      return rejectUpgrade(socket, "403 Forbidden", "Forbidden");
    }

    return webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, {
        conversationId: randomUUID(),
      });
    });
  });

  webSocketServer.on("connection", (socket, connection) => {
    const conversation = conversations.getOrCreate(connection.conversationId);
    const connectionLogger = wsLogger.child(null, {
      conversationId: connection.conversationId,
    });
    connectionLogger.info("ws.connected", { corpusVersion });
    let activeRequest = null;
    send(socket, {
      type: "connection.ready",
      protocolVersion: 2,
      corpusVersion,
      quota: conversations.quota(conversation),
    });
    send(socket, {
      type: "conversation.snapshot",
      ...conversations.snapshot(conversation),
    });

    socket.on("message", async (data) => {
      let event;
      try {
        event = parseClientEvent(data.toString());
      } catch {
        connectionLogger.warn("ws.invalid_event");
        send(socket, {
          type: "error",
          code: "invalid_event",
          message: "The request format is invalid.",
          fatal: false,
        });
        return;
      }

      if (!validateEventLimits(event, config)) {
        connectionLogger.warn("ws.request_too_large", {
          requestId: event.requestId,
        });
        send(socket, {
          type: "error",
          requestId: event.requestId,
          code: "request_too_large",
          message: "The message exceeds the allowed limit.",
          fatal: false,
        });
        return;
      }

      if (event.type === "chat.clear") {
        if (activeRequest) {
          activeRequest.controller.abort();
          conversations.failRequest(conversation, activeRequest.requestId);
          activeRequest = null;
        }
        if (conversation.activeRequest) {
          send(socket, {
            type: "error",
            code: "request_in_progress",
            message: "Another request is already in progress.",
            fatal: false,
          });
          return;
        }
        conversations.clearTranscript(conversation);
        connectionLogger.info("ws.chat_cleared");
        send(socket, {
          type: "conversation.snapshot",
          ...conversations.snapshot(conversation),
        });
        return;
      }

      if (event.type === "chat.cancel") {
        if (activeRequest?.requestId === event.requestId) {
          connectionLogger.info("ws.chat_cancelled", {
            requestId: event.requestId,
          });
          activeRequest.controller.abort();
          conversations.failRequest(conversation, event.requestId);
          activeRequest = null;
          send(socket, {
            type: "conversation.snapshot",
            ...conversations.snapshot(conversation),
          });
        }
        return;
      }

      if (activeRequest) {
        send(socket, {
          type: "error",
          requestId: event.requestId,
          code: "request_in_progress",
          message: "Another request is already in progress.",
          fatal: false,
        });
        return;
      }

      const intent = classifyConversationalMessage(event.message);
      const requestState = conversations.beginRequest(
        conversation,
        event.requestId,
        {
          countsAsProduct: !intent,
        },
      );
      if (requestState.status === "busy") {
        send(socket, {
          type: "error",
          requestId: event.requestId,
          code: "request_in_progress",
          message: "Another request is already in progress.",
          fatal: false,
        });
        return;
      }
      if (requestState.status === "handoff") {
        connectionLogger.info("ws.handoff", {
          requestId: event.requestId,
          usedProductTurns: conversations.quota(conversation).usedProductTurns,
        });
        const sources = [HANDOFF_SOURCE];
        const products = [];
        const assistantMessage = { content: HANDOFF_TEXT, sources, products };
        conversations.recordHandoff(conversation, event.requestId, {
          userMessage: event.message,
          assistantMessage,
        });
        send(socket, { type: "chat.accepted", requestId: event.requestId });
        send(socket, {
          type: "answer.delta",
          requestId: event.requestId,
          delta: HANDOFF_TEXT,
        });
        send(socket, {
          type: "answer.sources",
          requestId: event.requestId,
          sources,
        });
        send(socket, {
          type: "answer.products",
          requestId: event.requestId,
          products,
        });
        send(socket, {
          type: "answer.done",
          requestId: event.requestId,
          stopReason: "handoff",
          usage: null,
          handoff: true,
          quota: conversations.quota(conversation),
        });
        return;
      }

      const controller = new AbortController();
      activeRequest = { requestId: event.requestId, controller };
      connectionLogger.info("ws.chat_accepted", {
        requestId: event.requestId,
        intent: intent?.type || "product",
        ...previewText(event.message),
      });
      send(socket, { type: "chat.accepted", requestId: event.requestId });
      if (!intent) {
        send(socket, {
          type: "chat.progress",
          requestId: event.requestId,
          stage: "retrieving",
        });
      }

      try {
        let streamedAnswer = false;
        const answer = await orchestrator.answer({
          message: event.message,
          history: conversations.modelHistory(conversation),
          retrievalContext: conversations.retrievalContext(conversation),
          intent,
          signal: controller.signal,
          onProgress(stage) {
            send(socket, {
              type: "chat.progress",
              requestId: event.requestId,
              stage,
            });
          },
          onDelta(delta) {
            streamedAnswer = true;
            send(socket, {
              type: "answer.delta",
              requestId: event.requestId,
              delta,
            });
          },
        });
        if (controller.signal.aborted) return;

        const { sources, products } = serializeResults(answer.retrieval);
        conversations.completeRequest(conversation, event.requestId, {
          userMessage: event.message,
          assistantMessage: { content: answer.text, sources, products },
          productFgmns: products.map((product) => product.fgmn),
          countsAsProduct: !["social", "out-of-scope"].includes(answer.kind),
        });
        if (!streamedAnswer) {
          send(socket, {
            type: "answer.delta",
            requestId: event.requestId,
            delta: answer.text,
          });
        }
        send(socket, {
          type: "answer.sources",
          requestId: event.requestId,
          sources,
        });
        send(socket, {
          type: "answer.products",
          requestId: event.requestId,
          products,
        });
        send(socket, {
          type: "answer.done",
          requestId: event.requestId,
          stopReason: "complete",
          usage: answer.usage,
          handoff: false,
          quota: conversations.quota(conversation),
        });
        connectionLogger.info("ws.answer_done", {
          requestId: event.requestId,
          kind: answer.kind,
          outcome: answer.retrieval?.outcome,
          productCount: products.length,
          sourceCount: sources.length,
          usage: answer.usage,
        });
      } catch (error) {
        conversations.failRequest(conversation, event.requestId);
        if (controller.signal.aborted) {
          connectionLogger.info("ws.chat_aborted", {
            requestId: event.requestId,
          });
        } else {
          connectionLogger.error("ws.chat_failed", {
            requestId: event.requestId,
            code: classifyChatError(error),
            error,
          });
          send(socket, {
            type: "error",
            requestId: event.requestId,
            code: classifyChatError(error),
            message: "The answer could not be completed. Please retry.",
            fatal: false,
          });
        }
      } finally {
        if (activeRequest?.requestId === event.requestId) {
          activeRequest = null;
        }
      }
    });

    socket.on("close", () => {
      connectionLogger.info("ws.disconnected", {
        activeRequestId: activeRequest?.requestId || null,
      });
      activeRequest?.controller.abort();
      if (activeRequest)
        conversations.failRequest(conversation, activeRequest.requestId);
      activeRequest = null;
    });
  });

  const heartbeat = setInterval(() => {
    conversations.pruneExpired();
    for (const socket of webSocketServer.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, config.WS_HEARTBEAT_MS);
  heartbeat.unref();

  webSocketServer.on("connection", (socket) => {
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });
  });
  webSocketServer.on("close", () => clearInterval(heartbeat));

  return webSocketServer;
}

module.exports = {
  EASTMAN_INQUIRY_URL,
  HANDOFF_SOURCE,
  HANDOFF_TEXT,
  attachChatWebSocket,
  classifyChatError,
  serializeResults,
  validateEventLimits,
};
