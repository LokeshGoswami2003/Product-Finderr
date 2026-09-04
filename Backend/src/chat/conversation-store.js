function cloneMessage(message) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.sources
      ? { sources: message.sources.map((source) => ({ ...source })) }
      : {}),
    ...(message.products
      ? {
          products: message.products.map((product) => ({
            ...product,
            documents: { ...product.documents },
            links: { ...product.links },
          })),
        }
      : {}),
  };
}

function boundedMessages(messages, maxEntries, maxChars) {
  const selected = [];
  let characters = 0;

  for (
    let index = messages.length - 1;
    index >= 0 && selected.length < maxEntries;
    index -= 1
  ) {
    const message = messages[index];
    if (characters + message.content.length > maxChars) break;
    selected.unshift(message);
    characters += message.content.length;
  }

  return selected;
}

class ConversationStore {
  constructor({
    maxProductTurns = 3,
    maxHistoryTurns = 10,
    maxHistoryChars = 20_000,
    now = Date.now,
  } = {}) {
    this.maxProductTurns = maxProductTurns;
    this.maxHistoryTurns = maxHistoryTurns;
    this.maxHistoryChars = maxHistoryChars;
    this.now = now;
    this.conversations = new Map();
  }

  getOrCreate(id, expiresAt = Number.POSITIVE_INFINITY) {
    this.pruneExpired();
    let conversation = this.conversations.get(id);
    if (!conversation) {
      conversation = {
        id,
        expiresAt,
        messages: [],
        contextMessages: [],
        productTurns: 0,
        limitReached: false,
        recentProductFgmns: [],
        lastProductRequest: null,
        activeRequest: null,
      };
      this.conversations.set(id, conversation);
    } else if (Number.isFinite(expiresAt)) {
      conversation.expiresAt = expiresAt;
    }
    return conversation;
  }

  beginRequest(conversation, requestId, { countsAsProduct }) {
    if (conversation.activeRequest) return { status: "busy" };
    if (countsAsProduct && conversation.productTurns >= this.maxProductTurns) {
      conversation.limitReached = true;
      return { status: "handoff" };
    }

    conversation.activeRequest = { requestId, countsAsProduct };
    if (countsAsProduct) conversation.productTurns += 1;
    return { status: "started" };
  }

  completeRequest(
    conversation,
    requestId,
    {
      userMessage,
      assistantMessage,
      productFgmns = [],
      countsAsProduct: completedAsProduct,
    },
  ) {
    if (conversation.activeRequest?.requestId !== requestId) return false;
    const reservedAsProduct = conversation.activeRequest.countsAsProduct;
    const countsAsProduct =
      completedAsProduct === undefined
        ? reservedAsProduct
        : reservedAsProduct && completedAsProduct;
    if (reservedAsProduct && !countsAsProduct) {
      conversation.productTurns = Math.max(0, conversation.productTurns - 1);
    }
    conversation.activeRequest = null;
    const userEntry = { id: requestId, role: "user", content: userMessage };
    const assistantEntry = {
      id: `answer:${requestId}`,
      role: "assistant",
      ...assistantMessage,
    };
    conversation.messages.push(userEntry, assistantEntry);
    conversation.messages = boundedMessages(
      conversation.messages,
      this.maxHistoryTurns,
      this.maxHistoryChars,
    );

    if (countsAsProduct) {
      conversation.contextMessages.push(userEntry, assistantEntry);
      conversation.contextMessages = boundedMessages(
        conversation.contextMessages,
        this.maxHistoryTurns,
        this.maxHistoryChars,
      );
    }

    if (countsAsProduct && productFgmns.length > 0) {
      conversation.recentProductFgmns = [...new Set(productFgmns)].slice(0, 3);
      conversation.lastProductRequest = userMessage;
    }
    return true;
  }

  failRequest(conversation, requestId) {
    if (conversation.activeRequest?.requestId !== requestId) return false;
    if (conversation.activeRequest.countsAsProduct) {
      conversation.productTurns = Math.max(0, conversation.productTurns - 1);
    }
    conversation.activeRequest = null;
    return true;
  }

  recordHandoff(conversation, requestId, { userMessage, assistantMessage }) {
    conversation.limitReached = true;
    conversation.messages.push(
      { id: requestId, role: "user", content: userMessage },
      { id: `answer:${requestId}`, role: "assistant", ...assistantMessage },
    );
    conversation.messages = boundedMessages(
      conversation.messages,
      this.maxHistoryTurns,
      this.maxHistoryChars,
    );
  }

  clearTranscript(conversation) {
    conversation.messages = [];
    conversation.contextMessages = [];
    conversation.recentProductFgmns = [];
    conversation.lastProductRequest = null;
  }

  remove(id) {
    return this.conversations.delete(id);
  }

  modelHistory(conversation) {
    return boundedMessages(
      conversation.contextMessages,
      this.maxHistoryTurns,
      this.maxHistoryChars,
    ).map(({ role, content }) => ({ role, content }));
  }

  retrievalContext(conversation) {
    return {
      recentProductFgmns: [...conversation.recentProductFgmns],
      lastProductRequest: conversation.lastProductRequest,
    };
  }

  snapshot(conversation) {
    return {
      messages: boundedMessages(
        conversation.messages,
        this.maxHistoryTurns,
        this.maxHistoryChars,
      ).map(cloneMessage),
      quota: this.quota(conversation),
    };
  }

  quota(conversation) {
    return {
      maxProductTurns: this.maxProductTurns,
      usedProductTurns: conversation.productTurns,
      remainingProductTurns: Math.max(
        0,
        this.maxProductTurns - conversation.productTurns,
      ),
      limitReached: conversation.limitReached,
    };
  }

  pruneExpired() {
    const currentTime = this.now();
    for (const [id, conversation] of this.conversations) {
      if (conversation.expiresAt <= currentTime) this.conversations.delete(id);
    }
  }
}

module.exports = { ConversationStore, boundedMessages };
