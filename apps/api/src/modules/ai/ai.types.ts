import { z } from 'zod';

/** What the doctor sees after handwriting is read. Always shown for review, never saved automatically. */
export const handwritingResultSchema = z.object({
  text: z.string().max(20_000),
  uncertainWords: z.array(z.string().max(100)).max(100),
  language: z.enum(['english', 'urdu', 'mixed', 'unknown']),
});
export type HandwritingResult = z.output<typeof handwritingResultSchema>;

export const structuredNoteSchema = z.object({
  complaint: z.string().max(20_000),
  history: z.string().max(20_000),
  examination: z.string().max(20_000),
  diagnosis: z.string().max(20_000),
  plan: z.string().max(20_000),
});
export type StructuredNote = z.output<typeof structuredNoteSchema>;

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/** The AI features the rest of the application depends on. Swappable, so tests never call a real service. */
export interface AiProvider {
  /** False when no API key is configured. */
  readonly available: boolean;
  transcribeHandwriting(image: { data: Buffer; mime: ImageMime }): Promise<HandwritingResult>;
  structureNote(text: string): Promise<StructuredNote>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

/** Why an AI request could not give an answer. Each maps to a clear message for the user. */
export class AiError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'declined' | 'bad_output' | 'disabled',
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** A request sent to the model, independent of the vendor library. */
export interface AiRequest {
  system: string;
  userText: string;
  image?: { data: Buffer; mime: ImageMime };
  /** JSON Schema the answer must follow. */
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface AiResponse {
  stopReason: string | null;
  text: string;
}

export interface AiTransport {
  send(request: AiRequest): Promise<AiResponse>;
}
