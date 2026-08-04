/**
 * Gemini Bridge - Google Gemini integration with vision support
 *
 * SECURITY: `apiKey` in browser code is visible to anyone with devtools.
 * Prefer `proxyUrl` (this project already exposes /api/gemini/generate) so the
 * key stays on the server.
 */

export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface GeminiConfig {
  /** Server-side key. Do NOT ship in browser bundles — prefer `proxyUrl`. */
  apiKey?: string;
  /** Backend endpoint that holds the key, e.g. '/api/gemini/generate'. */
  proxyUrl?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  vision?: boolean;
}

export interface ContentPart {
  text?: string;
  inlineData?: {
    mimeType: ImageMimeType;
    /** Base64 payload WITHOUT the `data:...;base64,` prefix. */
    data: string;
  };
}

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: ContentPart[];
}

export interface GeminiResponse {
  text: string;
  model: string;
  timestamp: Date;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Accepts a data URL (`data:image/png;base64,iVBOR...`) or a bare base64 string
 * and returns the parts Gemini actually expects. Gemini's inlineData takes raw
 * base64 — handing it an http(s) URL silently produces garbage results.
 */
export function toInlineData(image: string, fallbackMime: ImageMimeType = 'image/jpeg') {
  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.*)$/i.exec(image.trim());
  if (match) {
    return { mimeType: match[1].toLowerCase() as ImageMimeType, data: match[2] };
  }
  if (/^https?:\/\//i.test(image)) {
    throw new Error(
      'Gemini inlineData requires base64 image content, not a URL. Fetch the image and pass a data URL (data:image/png;base64,...) instead.'
    );
  }
  return { mimeType: fallbackMime, data: image };
}

class GeminiBridge {
  private config: GeminiConfig;
  private conversationHistory: GeminiMessage[] = [];

  constructor(config: GeminiConfig) {
    this.config = {
      model: 'gemini-2.0-flash',
      temperature: 0.7,
      maxOutputTokens: 4096,
      vision: false,
      ...config,
    };
  }

  async prompt(message: string, image?: string): Promise<GeminiResponse> {
    const parts: ContentPart[] = [];

    if (image) {
      if (!this.config.vision) {
        throw new Error('Vision is disabled. Set vision: true to send images.');
      }
      parts.push({ inlineData: toInlineData(image) });
    }
    parts.push({ text: message });

    const turn: GeminiMessage = { role: 'user', parts };
    const response = await this.send([...this.conversationHistory, turn]);

    this.conversationHistory.push(turn);
    this.conversationHistory.push({ role: 'model', parts: [{ text: response.text }] });

    return response;
  }

  async chat(messages: GeminiMessage[]): Promise<GeminiResponse> {
    return this.send(messages);
  }

  async analyzeImage(image: string, prompt: string): Promise<GeminiResponse> {
    if (!this.config.vision) {
      throw new Error('Vision capabilities not enabled. Set vision: true in config.');
    }
    return this.send([
      { role: 'user', parts: [{ inlineData: toInlineData(image) }, { text: prompt }] },
    ]);
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  getHistory(): GeminiMessage[] {
    return [...this.conversationHistory];
  }

  private async send(contents: GeminiMessage[]): Promise<GeminiResponse> {
    const payload = {
      contents,
      generationConfig: {
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxOutputTokens,
      },
    };

    const { url, body } = this.config.proxyUrl
      ? { url: this.config.proxyUrl, body: { model: this.config.model, ...payload } }
      : {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${encodeURIComponent(this.requireKey())}`,
          body: payload,
        };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Gemini responded with status ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();

    // Proxy may return an already-flattened shape; handle both.
    const text: string =
      data.text ??
      (data.candidates?.[0]?.content?.parts ?? [])
        .map((part: { text?: string }) => part.text ?? '')
        .join('');

    return {
      text,
      model: this.config.model as string,
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
      timestamp: new Date(),
    };
  }

  private requireKey(): string {
    if (!this.config.apiKey) {
      throw new Error(
        'Gemini API key not configured. Set apiKey, or set proxyUrl to route through your server.'
      );
    }
    return this.config.apiKey;
  }
}

export default GeminiBridge;
