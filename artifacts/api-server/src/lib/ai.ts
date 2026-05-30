import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Typed AI errors (caught in routes to return friendly HTTP responses)
// ---------------------------------------------------------------------------

export class AiRateLimitError extends Error {
  constructor(message = "OpenAI rate limit hit") {
    super(message);
    this.name = "AiRateLimitError";
  }
}

export class AiQuotaError extends Error {
  constructor(message = "OpenAI quota exceeded") {
    super(message);
    this.name = "AiQuotaError";
  }
}

export class AiConfigError extends Error {
  constructor(message = "OpenAI API key not configured") {
    super(message);
    this.name = "AiConfigError";
  }
}

// ---------------------------------------------------------------------------
// Lazy client — reads the key at call time so hot-reloads and runtime
// secret injection both work correctly.
// ---------------------------------------------------------------------------

function getOpenAIClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.trim() === "") {
    throw new AiConfigError(
      "OPENAI_API_KEY is not set. Add it to your Replit Secrets then restart the server."
    );
  }
  return new OpenAI({ apiKey: key.trim() });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailGenerationOptions {
  name: string;
  email: string;
  vehicle?: string | null;
  route?: string | null;
  pickup?: string | null;
  delivery?: string | null;
  price?: string | null;
  notes?: string | null;
  templateSubject: string;
  templateBody: string;
  tone: string;
  customPrompt?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyTemplateVars(text: string, data: EmailGenerationOptions): string {
  return text
    .replace(/\{name\}/g, data.name ?? "")
    .replace(/\{vehicle\}/g, data.vehicle ?? "")
    .replace(/\{route\}/g, data.route ?? "")
    .replace(/\{pickup\}/g, data.pickup ?? "")
    .replace(/\{delivery\}/g, data.delivery ?? "")
    .replace(/\{price\}/g, data.price ?? "");
}

const TONE_DESCRIPTIONS: Record<string, string> = {
  professional: "formal, professional, and courteous",
  friendly: "warm, friendly, and conversational",
  sales: "persuasive, benefit-focused, and sales-oriented",
  followup: "gentle follow-up tone, referencing a prior conversation",
  urgent: "creates urgency while remaining professional",
};

// ---------------------------------------------------------------------------
// AI connection test (used by diagnostics / settings)
// ---------------------------------------------------------------------------

export async function testAiConnection(): Promise<{
  ok: boolean;
  provider: string;
  model: string;
  error?: string;
}> {
  try {
    const client = getOpenAIClient();
    await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 5,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true, provider: "openai", model: "gpt-4o-mini" };
  } catch (err: any) {
    if (err instanceof AiConfigError) {
      return { ok: false, provider: "openai", model: "gpt-4o-mini", error: err.message };
    }
    const msg = err?.message ?? String(err);
    return { ok: false, provider: "openai", model: "gpt-4o-mini", error: msg };
  }
}

// ---------------------------------------------------------------------------
// Main generation function
// ---------------------------------------------------------------------------

export async function generatePersonalizedEmail(
  opts: EmailGenerationOptions
): Promise<{ subject: string; body: string; tone: string }> {
  const openai = getOpenAIClient();

  const baseSubject = applyTemplateVars(opts.templateSubject, opts);
  const baseBody = applyTemplateVars(opts.templateBody, opts);
  const toneDesc = TONE_DESCRIPTIONS[opts.tone] ?? "professional";

  const systemPrompt = `You are an expert email writer for vehicle shipping brokers. Your job is to personalize and improve outreach emails that create Gmail drafts (NOT send emails automatically). The email should be ${toneDesc}. Avoid spam-trigger words. Write naturally and concisely. Focus on vehicle transport value.`;

  const userPrompt = `Personalize this email for a vehicle shipping lead:

Lead info:
- Name: ${opts.name}
- Vehicle: ${opts.vehicle ?? "not specified"}
- Route: ${opts.route ?? "not specified"}
- Pickup: ${opts.pickup ?? "not specified"}
- Delivery: ${opts.delivery ?? "not specified"}
- Price: ${opts.price ?? "not specified"}
- Notes: ${opts.notes ?? "none"}

Base subject: ${baseSubject}
Base body:
${baseBody}

${opts.customPrompt ? `Additional instructions: ${opts.customPrompt}` : ""}

Return JSON only with this exact shape:
{"subject": "...", "body": "..."}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { subject?: string; body?: string };

    return {
      subject: parsed.subject ?? baseSubject,
      body: parsed.body ?? baseBody,
      tone: opts.tone,
    };
  } catch (err: unknown) {
    if (err instanceof AiConfigError) throw err;

    if (err instanceof OpenAI.RateLimitError) {
      const msg = err.message ?? "";
      if (msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("insufficient")) {
        throw new AiQuotaError(msg);
      }
      throw new AiRateLimitError(msg);
    }
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401) {
        throw new AiConfigError(
          "Invalid OpenAI API key. Check your key in Replit Secrets."
        );
      }
      if (err.status === 429) {
        throw new AiRateLimitError(err.message);
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Followup generation — produces multiple email options for a given prompt
// ---------------------------------------------------------------------------

export async function generateFollowupOptions(
  prompt: string,
  count = 3
): Promise<Array<{ subject: string; body: string; tone: string }>> {
  const openai = getOpenAIClient();

  const systemPrompt = `You are an expert email writer for vehicle shipping brokers. Generate ${count} different follow-up email options based on the given scenario. Each should have a different tone/approach.`;

  const userPrompt = `Scenario: "${prompt}"

Generate exactly ${count} follow-up email options for vehicle shipping customers.
Return JSON array:
[
  { "subject": "...", "body": "...", "tone": "professional" },
  { "subject": "...", "body": "...", "tone": "friendly" },
  { "subject": "...", "body": "...", "tone": "urgent" }
]

Use {name}, {vehicle}, {pickup}, {delivery}, {price} as placeholders for personalization.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 2048,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content) as { options?: any[]; "0"?: any } | any[];
    const arr = Array.isArray(parsed) ? parsed : (parsed as any).options ?? Object.values(parsed as any);
    return arr.slice(0, count).map((o: any) => ({
      subject: o.subject ?? "Follow-up on your vehicle shipping",
      body: o.body ?? "",
      tone: o.tone ?? "professional",
    }));
  } catch {
    return [{ subject: "Follow-up on your vehicle shipping", body: content, tone: "professional" }];
  }
}
