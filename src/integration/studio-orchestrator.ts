/**
 * Studio Orchestrator - AI Studio-specific task orchestration
 * Optimized for AI-powered app generation and enhancement workflows
 */

import GeminiBridge, { type GeminiConfig } from './gemini-bridge';

export type StudioTaskType = 'generate' | 'analyze' | 'enhance' | 'debug' | 'document';

export interface StudioTask {
  id: string;
  type: StudioTaskType;
  description: string;
  context?: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  timestamp: Date;
}

export interface StudioConfig {
  gemini: GeminiConfig;
  maxHistory?: number;
}

let taskCounter = 0;

class StudioOrchestrator {
  /** Exposed so callers can send bespoke prompts without a task wrapper. */
  readonly gemini: GeminiBridge;

  private tasks: Map<string, StudioTask> = new Map();
  private history: StudioTask[] = [];
  private config: StudioConfig;

  constructor(config: StudioConfig) {
    this.config = { maxHistory: 50, ...config };
    this.gemini = new GeminiBridge(config.gemini);
  }

  /**
   * Single path every task flows through: build the task, call Gemini, record
   * the outcome. Keeps status/error/history handling identical everywhere.
   */
  private async run(
    type: StudioTaskType,
    description: string,
    prompt: string,
    options: { image?: string; context?: Record<string, unknown> } = {}
  ): Promise<StudioTask> {
    const task: StudioTask = {
      id: `task_${Date.now()}_${++taskCounter}`,
      type,
      description,
      context: options.context,
      status: 'running',
      timestamp: new Date(),
    };
    this.tasks.set(task.id, task);

    try {
      const response = await this.gemini.prompt(prompt, options.image);
      task.result = response.text;
      task.status = 'completed';
    } catch (cause) {
      task.status = 'failed';
      task.error = cause instanceof Error ? cause.message : String(cause);
    }

    this.addToHistory(task);
    return task;
  }

  generateComponent(description: string, image?: string): Promise<StudioTask> {
    const prompt = [
      'You are an expert React component generator.',
      'Generate clean, well-structured components using TypeScript and Tailwind CSS.',
      'Follow shadcn/ui patterns where applicable. Return only code.',
      '',
      `Generate: ${description}`,
    ].join('\n');
    return this.run('generate', description, prompt, { image });
  }

  analyzeCode(code: string): Promise<StudioTask> {
    return this.run(
      'analyze',
      'Analyze code',
      `Analyze this code and report structure, likely bugs, performance concerns, and best-practice gaps:\n\n${code}`
    );
  }

  enhanceCode(code: string, enhancement: string): Promise<StudioTask> {
    return this.run(
      'enhance',
      enhancement,
      `Enhance the following code with: ${enhancement}\n\nCode:\n${code}`,
      { context: { originalCode: code } }
    );
  }

  debugIssue(issue: string, context?: string): Promise<StudioTask> {
    const prompt = context
      ? `Debug and fix this error:\n${issue}\n\nContext:\n${context}`
      : `Debug and fix this error:\n${issue}`;
    return this.run('debug', issue, prompt, { context: context ? { context } : undefined });
  }

  generateDocumentation(code: string): Promise<StudioTask> {
    return this.run(
      'document',
      'Generate documentation',
      `Generate documentation for this code. Include purpose, parameters, return values, usage examples, and edge cases:\n\n${code}`
    );
  }

  getTask(id: string): StudioTask | undefined {
    return this.tasks.get(id);
  }

  getHistory(limit?: number): StudioTask[] {
    return this.history.slice(-(limit ?? this.config.maxHistory ?? 50));
  }

  clearHistory(): void {
    this.history = [];
    this.tasks.clear();
    this.gemini.clearHistory();
  }

  private addToHistory(task: StudioTask): void {
    this.history.push(task);
    const cap = this.config.maxHistory ?? 50;
    if (this.history.length > cap) {
      this.history.shift();
    }
  }

  getStatus(): Record<string, unknown> {
    return {
      activeTasks: [...this.tasks.values()].filter((t) => t.status === 'running').length,
      totalTasks: this.tasks.size,
      historySize: this.history.length,
      timestamp: new Date(),
    };
  }
}

export default StudioOrchestrator;
