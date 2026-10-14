import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../../config/config';
import { AiError, type AiRequest, type AiResponse, type AiTransport } from './ai.types';

/**
 * The only file that knows about the Anthropic library.
 *
 * - Server-side fallbacks are switched on, so a request the main model declines is retried by
 *   Anthropic on a fallback model instead of failing.
 * - A timeout and one retry keep a slow AI call from holding up the clinic's work.
 * - Thinking is adaptive and effort is medium: reading handwriting benefits from care, not from long reasoning.
 */
export class AnthropicTransport implements AiTransport {
  private readonly client: Anthropic;

  constructor(private readonly config: AppConfig) {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 1, timeout: config.aiTimeoutMs });
  }

  async send(request: AiRequest): Promise<AiResponse> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (request.image !== undefined) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: request.image.mime, data: request.image.data.toString('base64') },
      });
    }
    content.push({ type: 'text', text: request.userText });

    try {
      const message = await this.client.beta.messages.create({
        model: this.config.aiModel,
        max_tokens: request.maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: request.schema } },
        system: request.system,
        messages: [{ role: 'user', content }],
      });
      const text = message.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return { stopReason: message.stop_reason, text };
    } catch (error) {
      if (error instanceof Anthropic.APIError || error instanceof Anthropic.APIConnectionError) {
        // The vendor message may contain request details, so it is not passed on to the user.
        throw new AiError('unavailable', 'The AI service is not available right now.');
      }
      throw error;
    }
  }
}
