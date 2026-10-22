import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { BackgroundCoordinator } from "./backgroundCoordinator";
import { diagnostics, initializeEngine, scheduler } from "./runtime";
export const BACKGROUND_TASK = "cinetor-catalog-refresh-v1";
// Imported from index.ts at module scope, so Android headless execution can find the task.
if (!TaskManager.isTaskDefined(BACKGROUND_TASK))
  TaskManager.defineTask(BACKGROUND_TASK, async ({ error }) => {
    if (error) return BackgroundTask.BackgroundTaskResult.Failed;
    try {
      await initializeEngine();
      await scheduler.run("background");
      return diagnostics.value.state === "failed"
        ? BackgroundTask.BackgroundTaskResult.Failed
        : BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
const coordinator = new BackgroundCoordinator({
  available: async () =>
    (await TaskManager.isAvailableAsync()) &&
    (await BackgroundTask.getStatusAsync()) ===
      BackgroundTask.BackgroundTaskStatus.Available,
  registered: () => TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK),
  register: () =>
    BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 15 }),
});
export async function registerBackground(): Promise<void> {
  try {
    diagnostics.update({
      background: (await coordinator.register()) ? "registered" : "unavailable",
    });
  } catch {
    diagnostics.update({ background: "failed" });
  }
}
