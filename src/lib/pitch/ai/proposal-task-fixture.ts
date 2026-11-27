type TaskCommand = {
  action: string;
  taskId: string;
  sourceProjectId?: string;
  confirmation?: unknown;
  generation?: Record<string, unknown>;
  errorCode?: string;
};
type Task = {
  id: string;
  source_project_id: string;
  state: "queued" | "processing" | "completed" | "failed";
  command: { confirmation: unknown };
  errorCode?: string;
};

/** Only the PostgreSQL receipt protocol is simulated. Prepare, review, render,
 * task claim and HTTP dispatch still run through the application. */
export function createProposalTaskFixture(commit: (generation: Record<string, unknown>) => void) {
  const tasks = new Map<string, Task>();
  const workers: (() => Promise<void>)[] = [];
  return {
    schedule(worker: () => Promise<void>) {
      workers.push(worker);
    },
    async finish() {
      for (const worker of workers.splice(0)) await worker();
    },
    inspect(taskId: string) {
      return tasks.get(taskId);
    },
    rpc(command: TaskCommand) {
      const task = tasks.get(command.taskId);
      if (command.action === "workspace_proposal_lookup") return task ?? null;
      if (command.action === "workspace_proposal_start" && command.sourceProjectId) {
        const created: Task = { id: command.taskId, source_project_id: command.sourceProjectId,
          state: "queued", command: { confirmation: command.confirmation } };
        tasks.set(created.id, created);
        return created;
      }
      if (!task) throw new Error("Missing fixture task");
      switch (command.action) {
        case "workspace_proposal_claim":
          if (task.state !== "queued") return { claimed: false };
          task.state = "processing";
          return { claimed: true, task };
        case "workspace_proposal_assemble":
          return {};
        case "workspace_proposal_complete":
          if (!command.generation || task.state !== "processing") throw new Error("Invalid fixture generation");
          commit(command.generation);
          task.state = "completed";
          return task;
        case "workspace_proposal_fail":
          task.state = "failed";
          task.errorCode = command.errorCode;
          return task;
        default:
          throw new Error("Unexpected fixture operation " + command.action);
      }
    },
  };
}
