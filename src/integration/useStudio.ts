/**
 * React Hook - useStudio
 * Simple interface for AI Studio orchestration within React components
 */

import { useCallback, useState } from 'react';
import StudioOrchestrator, { type StudioConfig, type StudioTask } from './studio-orchestrator';

export function useStudio(config: StudioConfig) {
  // Lazy initializer runs exactly once — no setState during render.
  const [orchestrator] = useState(() => new StudioOrchestrator(config));
  const [tasks, setTasks] = useState<StudioTask[]>([]);
  const [currentTask, setCurrentTask] = useState<StudioTask | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Every action shares one lifecycle: clear error, run, record, surface failure. */
  const track = useCallback(async (work: () => Promise<StudioTask>): Promise<StudioTask> => {
    setError(null);
    setIsRunning(true);
    try {
      const task = await work();
      setCurrentTask(task);
      setTasks((prev) => [...prev, task]);
      if (task.status === 'failed' && task.error) {
        setError(task.error);
      }
      return task;
    } finally {
      setIsRunning(false);
    }
  }, []);

  const generateComponent = useCallback(
    (description: string, image?: string) =>
      track(() => orchestrator.generateComponent(description, image)),
    [orchestrator, track]
  );

  const analyzeCode = useCallback(
    (code: string) => track(() => orchestrator.analyzeCode(code)),
    [orchestrator, track]
  );

  const enhanceCode = useCallback(
    (code: string, enhancement: string) =>
      track(() => orchestrator.enhanceCode(code, enhancement)),
    [orchestrator, track]
  );

  const debugIssue = useCallback(
    (issue: string, context?: string) => track(() => orchestrator.debugIssue(issue, context)),
    [orchestrator, track]
  );

  const generateDocumentation = useCallback(
    (code: string) => track(() => orchestrator.generateDocumentation(code)),
    [orchestrator, track]
  );

  const clearHistory = useCallback(() => {
    orchestrator.clearHistory();
    setTasks([]);
    setCurrentTask(null);
    setError(null);
  }, [orchestrator]);

  const getStatus = useCallback(() => orchestrator.getStatus(), [orchestrator]);

  return {
    isReady: true,
    isRunning,
    tasks,
    currentTask,
    error,
    generateComponent,
    analyzeCode,
    enhanceCode,
    debugIssue,
    generateDocumentation,
    clearHistory,
    getStatus,
    orchestrator,
  };
}

export type UseStudioReturn = ReturnType<typeof useStudio>;
