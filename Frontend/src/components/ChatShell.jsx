import { useEffect, useReducer, useRef, useState } from "react";
import { FormattedAnswer } from "./FormattedAnswer";
import { ProductCard } from "./ProductCard";
import { EastmanPageMock } from "./EastmanPageMock";
import { useChatSocket } from "../hooks/useChatSocket";
import { log } from "../lib/logger";
import { chatReducer, initialChatState } from "../state/chat";
import { safeEastmanUrl } from "../protocol/links";

const STARTERS = [
  "I need selective H2S removal",
  "What is AdapT 100?",
  "Compare AdapT 100 and AdapT 201",
];

export function ChatShell() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [draft, setDraft] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const conversationRef = useRef(null);
  const conversationEndRef = useRef(null);
  const followConversationRef = useRef(true);

  const { status, connect, send } = useChatSocket({
    enabled: true,
    onEvent(event) {
      const requestId = event.requestId;
      switch (event.type) {
        case "connection.ready":
          dispatch({ type: "connection.ready", quota: event.quota });
          break;
        case "conversation.snapshot":
          dispatch({
            type: "conversation.snapshot",
            messages: event.messages,
            quota: event.quota,
          });
          break;
        case "chat.accepted":
          dispatch({ type: "request.accepted" });
          break;
        case "chat.progress":
          dispatch({ type: "request.progress", stage: event.stage });
          break;
        case "answer.delta":
          dispatch({ type: "answer.delta", requestId, delta: event.delta });
          break;
        case "answer.sources":
          dispatch({
            type: "answer.sources",
            requestId,
            sources: event.sources,
          });
          break;
        case "answer.products":
          dispatch({
            type: "answer.products",
            requestId,
            products: event.products,
          });
          break;
        case "answer.done":
          dispatch({ type: "answer.done", quota: event.quota });
          break;
        case "error":
          dispatch({ type: "request.error", message: event.message });
          break;
        default:
          break;
      }
    },
  });

  useEffect(() => {
    if (!isOpen || !followConversationRef.current) return undefined;
    const frame = requestAnimationFrame(() => {
      conversationEndRef.current?.scrollIntoView({
        behavior: "auto",
        block: "nearest",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, state.messages, state.progress]);

  function updateScrollPreference() {
    const container = conversationRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    followConversationRef.current = distanceFromBottom < 80;
  }

  function submit(message = draft) {
    const trimmed = message.trim();
    if (
      !trimmed ||
      state.activeRequestId ||
      state.quota.limitReached ||
      status !== "connected"
    )
      return;

    const requestId = crypto.randomUUID();
    log("chat", "request_sent", { requestId, chars: trimmed.length });
    const sent = send({
      type: "chat.request",
      requestId,
      message: trimmed,
      region: null,
    });
    if (!sent) return;

    followConversationRef.current = true;
    dispatch({ type: "request.started", requestId, message: trimmed });
    setDraft("");
  }

  function cancel() {
    if (!state.activeRequestId) return;
    send({ type: "chat.cancel", requestId: state.activeRequestId });
    dispatch({ type: "request.cancelled" });
  }

  function clearChat() {
    if (state.activeRequestId) {
      send({ type: "chat.cancel", requestId: state.activeRequestId });
    }
    if (send({ type: "chat.clear" })) {
      dispatch({ type: "chat.clear" });
    }
  }

  const statusLabel =
    status === "connected"
      ? "Online"
      : status === "connecting"
        ? "Connecting"
        : "Offline";

  return (
    <main className="preview-page">
      <EastmanPageMock />
      <div className="site-veil" />

      {isOpen ? (
        <aside className="chat-widget" aria-label="Eastman product finder">
          <header className="widget-header">
            <div className="assistant-identity">
              <span className="assistant-mark" aria-hidden="true">
                ✦
              </span>
              <div>
                <strong>Product finder</strong>
                <span
                  className={`assistant-status assistant-status--${status}`}
                >
                  <i aria-hidden="true" /> {statusLabel}
                </span>
              </div>
            </div>
            <div className="widget-actions">
              <button
                type="button"
                onClick={clearChat}
                disabled={state.quota.limitReached}
                aria-label="Clear chat context"
                title="Clear chat context"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5H6.8A2.8 2.8 0 0 0 4 7.8v9.4A2.8 2.8 0 0 0 6.8 20h9.4a2.8 2.8 0 0 0 2.8-2.8V12M15.5 4.5h4v4M19.3 4.7l-7.8 7.8" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Minimize product finder"
                title="Minimize"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14" />
                </svg>
              </button>
            </div>
          </header>

          <div
            className="widget-body"
            ref={conversationRef}
            onScroll={updateScrollPreference}
          >
            {state.messages.length === 0 && (
              <section className="chat-welcome" aria-labelledby="welcome-title">
                <p className="widget-kicker">EASTMAN PRODUCT SUPPORT</p>
                <h1 id="welcome-title">What are you looking for?</h1>
                <p>
                  Describe your application or name a product. I’ll search the
                  Eastman catalog and show the most relevant options.
                </p>
                <div className="starter-list" aria-label="Suggested questions">
                  {STARTERS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => submit(prompt)}
                      disabled={status !== "connected"}
                    >
                      <span>{prompt}</span>
                      <span aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section
              className="conversation"
              aria-label="Product finder conversation"
            >
              <div className="message-list">
                {state.messages.map((message) => (
                  <article
                    className={`message message--${message.role}${message.id === `answer:${state.activeRequestId}` ? " message--streaming" : ""}`}
                    key={message.id}
                  >
                    <span className="sr-only">
                      {message.role === "user" ? "You" : "Product finder"}:
                    </span>
                    {message.role === "assistant" && (
                      <span className="message-mark" aria-hidden="true">
                        ✦
                      </span>
                    )}
                    <div className="message-bubble">
                      {message.role === "assistant" ? (
                        <FormattedAnswer content={message.content} />
                      ) : (
                        <p className="message-content">{message.content}</p>
                      )}
                      {message.products?.map((product) => (
                        <ProductCard key={product.fgmn} product={product} />
                      ))}
                      {message.sources?.length > 0 && (
                        <details className="sources">
                          <summary>
                            {message.sources.length} official{" "}
                            {message.sources.length === 1
                              ? "source"
                              : "sources"}
                          </summary>
                          <ul>
                            {message.sources.map((source) => {
                              const url = safeEastmanUrl(source.url);
                              return url ? (
                                <li key={source.id}>
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {source.title}
                                  </a>
                                </li>
                              ) : null;
                            })}
                          </ul>
                        </details>
                      )}
                    </div>
                  </article>
                ))}
              </div>

              {state.progress && (
                <div
                  className="progress-message"
                  role="status"
                  aria-live="polite"
                >
                  <span className="message-mark" aria-hidden="true">
                    ✦
                  </span>
                  <span>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="sr-only">{state.progress}</span>
                </div>
              )}
              {state.error && (
                <p className="chat-error" role="alert">
                  {state.error}
                </p>
              )}
              {status === "disconnected" && (
                <div className="connection-notice">
                  <span>Product finder is offline.</span>
                  <button type="button" onClick={connect}>
                    Reconnect
                  </button>
                </div>
              )}
              {state.quota.limitReached && (
                <p className="handoff-notice" role="status">
                  Guided chat complete. Continue with Eastman product support
                  using the official inquiry link above.
                </p>
              )}
              <div ref={conversationEndRef} />
            </section>
          </div>

          <footer className="widget-composer">
            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <label className="sr-only" htmlFor="chat-message">
                Ask about an Eastman product
              </label>
              <textarea
                id="chat-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={state.quota.limitReached}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={
                  state.quota.limitReached
                    ? "Continue with Eastman product support"
                    : "Ask about a product or application"
                }
                maxLength={4000}
                rows={1}
              />
              {draft.length > 3500 && (
                <span className="character-count">{draft.length}/4000</span>
              )}
              {state.activeRequestId ? (
                <button
                  className="send-button stop-button"
                  type="button"
                  onClick={cancel}
                  aria-label="Stop response"
                >
                  <span aria-hidden="true" />
                </button>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  disabled={
                    !draft.trim() ||
                    status !== "connected" ||
                    state.quota.limitReached
                  }
                  aria-label="Send message"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m5 12 14-7-4.5 14-3-5.5L5 12Zm6.5 1.5L19 5" />
                  </svg>
                </button>
              )}
            </form>
            <p className="widget-note">
              {state.quota.limitReached
                ? "Eastman product support can continue your review."
                : state.quota.remainingProductTurns === 0
                  ? "Send once more for Eastman contact guidance."
                  : `${state.quota.remainingProductTurns} guided product ${state.quota.remainingProductTurns === 1 ? "question" : "questions"} remaining.`}
            </p>
          </footer>
        </aside>
      ) : (
        <button
          className="chat-launcher"
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open Eastman product finder"
        >
          <span className="launcher-mark" aria-hidden="true">
            ✦
          </span>
          <span>Product finder</span>
        </button>
      )}
    </main>
  );
}
