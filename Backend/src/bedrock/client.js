const { createLogger } = require("../config/logger");

class BedrockError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = "BedrockError";
    this.status = status;
    this.code = code;
  }
}

function defaultBaseUrl(region) {
  return `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`;
}

class BedrockClient {
  constructor({
    apiKey,
    model = "deepseek.v3.2",
    region = "ap-south-1",
    baseUrl,
    timeoutMs = 120_000,
    fetchImpl = fetch,
    logger = createLogger({ name: "bedrock" }),
  } = {}) {
    if (typeof apiKey !== "string" || apiKey.trim() === "") {
      throw new TypeError("A Bedrock API key is required");
    }

    this.apiKey = apiKey;
    this.model = model;
    this.region = region;
    this.baseUrl = (baseUrl || defaultBaseUrl(region)).replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.logger = logger.child("bedrock");
  }

  combinedSignal(signal) {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  }

  async request(payload, signal) {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: this.combinedSignal(signal),
    });
    return response;
  }

  async responseError(response) {
    const body = await response.json().catch(() => null);
    return new BedrockError(
      body?.error?.message ||
        `Bedrock request failed with status ${response.status}`,
      {
        status: response.status,
        code: body?.error?.code || null,
      },
    );
  }

  buildPayload({ messages, responseFormat, maxTokens, stream = false }) {
    return {
      model: this.model,
      messages,
      ...(stream ? { stream: true } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    };
  }

  async createChatCompletion({ messages, signal, responseFormat, maxTokens }) {
    const startedAt = Date.now();
    this.logger.info("bedrock.request", {
      mode: "complete",
      model: this.model,
      messageCount: messages.length,
      json: Boolean(responseFormat),
    });
    let response;
    try {
      response = await this.request(
        this.buildPayload({ messages, responseFormat, maxTokens }),
        signal,
      );
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      this.logger.error("bedrock.unreachable", {
        mode: "complete",
        error,
      });
      throw new BedrockError("Bedrock could not be reached", {
        code: error?.code || null,
      });
    }

    if (!response.ok) {
      const error = await this.responseError(response);
      this.logger.error("bedrock.http_error", {
        mode: "complete",
        status: error.status,
        code: error.code,
        error,
      });
      throw error;
    }

    let completion;
    try {
      completion = await response.json();
    } catch {
      throw new BedrockError("Bedrock returned malformed JSON", {
        status: response.status,
      });
    }

    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new BedrockError("Bedrock returned no answer", {
        status: response.status,
      });
    }
    this.logger.info("bedrock.response", {
      mode: "complete",
      model: completion.model || this.model,
      ms: Date.now() - startedAt,
      answerChars: content.length,
      usage: completion.usage || null,
    });
    return completion;
  }

  async createChatCompletionStream({
    messages,
    signal,
    responseFormat,
    maxTokens,
    onDelta = () => {},
  }) {
    const startedAt = Date.now();
    this.logger.info("bedrock.request", {
      mode: "stream",
      model: this.model,
      messageCount: messages.length,
    });
    let response;
    try {
      response = await this.request(
        this.buildPayload({
          messages,
          responseFormat,
          maxTokens,
          stream: true,
        }),
        signal,
      );
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      this.logger.error("bedrock.unreachable", {
        mode: "stream",
        error,
      });
      throw new BedrockError("Bedrock could not be reached", {
        code: error?.code || null,
      });
    }

    if (!response.ok) {
      const error = await this.responseError(response);
      this.logger.error("bedrock.http_error", {
        mode: "stream",
        status: error.status,
        code: error.code,
        error,
      });
      throw error;
    }
    if (!response.body) {
      throw new BedrockError("The Bedrock streaming response had no body", {
        status: response.status,
      });
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let usage = null;
    let model = null;

    const consumeEvent = (event) => {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") return;

      const payload = JSON.parse(data);
      if (payload.error) {
        throw new BedrockError(
          payload.error.message || "Bedrock reported a streaming failure",
          { code: payload.error.code || null },
        );
      }
      const delta = payload.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        text += delta;
        onDelta(delta);
      }
      if (payload.usage) usage = payload.usage;
      if (payload.model) model = payload.model;
    };

    try {
      for await (const chunk of response.body) {
        buffer += decoder
          .decode(chunk, { stream: true })
          .replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          consumeEvent(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) consumeEvent(buffer);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      if (error instanceof BedrockError) throw error;
      throw new BedrockError("The Bedrock stream ended unexpectedly", {
        code: error?.code || null,
      });
    }

    if (text.trim() === "") {
      throw new BedrockError("Bedrock returned an empty stream", {
        status: response.status,
      });
    }

    this.logger.info("bedrock.response", {
      mode: "stream",
      model: model || this.model,
      ms: Date.now() - startedAt,
      answerChars: text.length,
      usage,
    });
    return {
      choices: [{ message: { content: text } }],
      usage,
      ...(model ? { model } : {}),
    };
  }
}

module.exports = { BedrockClient, BedrockError, defaultBaseUrl };
