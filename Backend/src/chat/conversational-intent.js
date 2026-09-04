const SOCIAL_RESPONSES = {
  greeting:
    "Hello! I’m your Eastman product assistant. I can help you find products by application or performance need, compare up to three options, and review official TDS or regional SDS information. What are you working on?",
  gratitude:
    "You’re welcome. Tell me the application, material, performance requirement, or region when you’re ready, and I’ll help narrow the most relevant Eastman options.",
  goodbye:
    "Thank you for using the Eastman product finder. When you return, bring the application, performance requirement, or product name and I’ll help you take the next step.",
  capability:
    "I can help identify Eastman products, compare up to three relevant options, and explain technical or safety information from official product, TDS, and regional SDS sources. Start with a product name, application, material, performance requirement, or region.",
  outOfScope:
    "I’m here specifically for Eastman product questions, so I can’t help with that topic. Ask me about a product, application, performance requirement, comparison, TDS, SDS, or how to contact Eastman product support.",
};

function normalizeSocialText(message) {
  return message
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function classifyConversationalMessage(message) {
  const text = normalizeSocialText(message);
  if (!text) return null;

  const greeting =
    /^(?:(?:hi+|hello+|hey+|hiya|howdy|greetings|namaste|yo|good (?:morning|afternoon|evening))(?: there| everyone| team| sir| madam| maam| bot| assistant| product finder)?(?: how are you(?: doing)?| how is it going| hope you are (?:well|doing well))?|how are you(?: doing)?|how is it going|hows it going|whats up|sup|nice to meet you|pleasure to meet you)$/;
  if (greeting.test(text)) {
    return {
      type: "social",
      subtype: "greeting",
      response: SOCIAL_RESPONSES.greeting,
    };
  }

  const gratitude =
    /^(?:thanks?|thank you|thank you very much|many thanks|thanks a lot|much appreciated|appreciate it|i appreciate it|great thanks|perfect thanks|got it thanks|okay thanks|ok thanks|thx|great|awesome|perfect|cool|understood|got it|sounds good)$/;
  if (gratitude.test(text)) {
    return {
      type: "social",
      subtype: "gratitude",
      response: SOCIAL_RESPONSES.gratitude,
    };
  }

  const goodbye =
    /^(?:bye|goodbye|good bye|see you|see you later|talk to you later|talk later|good night|have a good (?:day|evening|night)|take care|thats all|that is all)$/;
  if (goodbye.test(text)) {
    return {
      type: "social",
      subtype: "goodbye",
      response: SOCIAL_RESPONSES.goodbye,
    };
  }

  const capability =
    /^(?:help|help me|what can you do|what do you do|how can you help|how does this work|who are you|what are you|show me what you can do)$/;
  if (capability.test(text)) {
    return {
      type: "social",
      subtype: "capability",
      response: SOCIAL_RESPONSES.capability,
    };
  }

  const promptAttack =
    /^(?:(?:ignore|disregard|forget) (?:all )?(?:previous|prior|system) (?:instructions|prompts)|(?:show|reveal|print) (?:your )?(?:system prompt|hidden instructions|evidence json))/;
  if (promptAttack.test(text)) {
    return {
      type: "out-of-scope",
      subtype: "out-of-scope",
      response: SOCIAL_RESPONSES.outOfScope,
    };
  }

  return null;
}

function stripLeadingGreeting(message) {
  const stripped = message.replace(
    /^\s*(?:(?:hi+|hello+|hey+|hiya|howdy|greetings|namaste|good\s+(?:morning|afternoon|evening))(?:\s+there|\s+team|\s+sir|\s+madam|\s+ma'am)?)[\s,!;:—–-]+/i,
    "",
  );
  return stripped.trim() || message.trim();
}

module.exports = {
  SOCIAL_RESPONSES,
  classifyConversationalMessage,
  normalizeSocialText,
  stripLeadingGreeting,
};
