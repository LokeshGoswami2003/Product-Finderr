export const initialChatState = {
  messages: [],
  activeRequestId: null,
  progress: null,
  error: null,
  quota: {
    maxProductTurns: 3,
    usedProductTurns: 0,
    remainingProductTurns: 3,
    limitReached: false,
  },
};

export function chatReducer(state, action) {
  switch (action.type) {
    case "connection.ready":
      return { ...state, quota: action.quota || state.quota };
    case "conversation.snapshot":
      return {
        ...state,
        messages: action.messages,
        activeRequestId: null,
        progress: null,
        error: null,
        quota: action.quota || state.quota,
      };
    case "request.started":
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: action.requestId, role: "user", content: action.message },
        ],
        activeRequestId: action.requestId,
        progress: "Connecting your request to the product catalog…",
        error: null,
      };
    case "request.accepted":
      return { ...state, progress: "Searching the Eastman catalog…" };
    case "request.progress":
      return { ...state, progress: progressLabel(action.stage) };
    case "answer.delta": {
      const answerId = `answer:${action.requestId}`;
      const existing = state.messages.find(
        (message) => message.id === answerId,
      );
      const messages = existing
        ? state.messages.map((message) =>
            message.id === answerId
              ? { ...message, content: message.content + action.delta }
              : message,
          )
        : [
            ...state.messages,
            {
              id: answerId,
              role: "assistant",
              content: action.delta,
              sources: [],
              products: [],
            },
          ];
      return { ...state, messages, progress: null };
    }
    case "answer.sources":
      return updateAnswer(state, action.requestId, { sources: action.sources });
    case "answer.products":
      return updateAnswer(state, action.requestId, {
        products: action.products,
      });
    case "answer.done":
      return {
        ...state,
        activeRequestId: null,
        progress: null,
        quota: action.quota || state.quota,
      };
    case "request.error":
      return {
        ...state,
        activeRequestId: null,
        progress: null,
        error: action.message,
      };
    case "request.cancelled":
      return { ...state, activeRequestId: null, progress: null };
    case "chat.clear":
      return {
        ...initialChatState,
        quota: state.quota,
      };
    default:
      return state;
  }
}

function updateAnswer(state, requestId, values) {
  const answerId = `answer:${requestId}`;
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.id === answerId ? { ...message, ...values } : message,
    ),
  };
}

function progressLabel(stage) {
  const labels = {
    retrieving: "Searching the Eastman catalog…",
    grounding: "Reviewing product information…",
    generating: "Preparing your answer…",
  };
  return labels[stage] || "Working on your request…";
}
