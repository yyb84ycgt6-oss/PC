/**
 * AI Studio Integration Module
 * Specialized LLM integration for Google Gemini and AI-powered workflows
 */

export { default as GeminiBridge, toInlineData } from './gemini-bridge';
export type {
  GeminiConfig,
  GeminiMessage,
  GeminiResponse,
  ContentPart,
  ImageMimeType,
} from './gemini-bridge';

export { default as StudioOrchestrator } from './studio-orchestrator';
export type { StudioTask, StudioTaskType, StudioConfig } from './studio-orchestrator';

export { useStudio } from './useStudio';
export type { UseStudioReturn } from './useStudio';
