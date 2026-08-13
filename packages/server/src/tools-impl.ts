import {
  DEFAULT_RECALL_K,
  type BranchId,
  type CheckpointInput,
  type CheckpointResult,
  type ForkFromInput,
  type ForkFromResult,
  type ListBranchesResult,
  type Message,
  type MemoryEngine,
  type MemoryKind,
  type PromoteInput,
  type PromoteResult,
  type RecallInput,
  type RecallResult,
  type RememberInput,
  type RememberResult,
  type ResumeInput,
  type ResumeResult,
  type TrunkDb,
} from "@trunk/core";
import { loadGraph, summarizeBranches } from "./branches.js";
import { distillBrief, formatResumeMemories } from "./brief.js";
import {
  ancestryForBranch,
  ancestryForCheckpoint,
  checkpointById,
  createCheckpoint,
  createForkBranch,
  createImplicitMemoryCheckpoint,
  ensureMainBranch,
  getBranchOrThrow,
  latestCheckpointForBranch,
} from "./dag.js";
import { suggestDivergence, type DivergenceSuggestion } from "./divergence.js";

interface CheckpointAdvisory {
  fork_suggestion?: DivergenceSuggestion;
}

export class TrunkTools {
  private currentBranchId: BranchId | null = null;

  constructor(
    private readonly trunk: TrunkDb,
    private readonly memory: MemoryEngine,
  ) {}

  async initialize(): Promise<void> {
    const branch = await ensureMainBranch(this.trunk);
    this.currentBranchId = branch._id;
  }

  async checkpoint(input: CheckpointInput): Promise<CheckpointResult & CheckpointAdvisory> {
    const branchId = await this.requireCurrentBranchId();
    const checkpoint = await createCheckpoint(this.trunk, branchId, {
      label: input.label,
      summary: input.summary,
      userMessage: input.user_message,
      assistantMessage: input.assistant_message,
    });

    const candidates = await this.memory.extract({
      checkpoint_id: checkpoint._id,
      branch_id: branchId,
      user: input.user_message,
      assistant: input.assistant_message,
    });
    const normalized = candidates.map((candidate) => ({
      ...candidate,
      scope: candidate.kind === "fact" ? "trunk" : branchId,
    }));
    for (const candidate of normalized) {
      await this.memory.write(candidate);
    }

    const result: CheckpointResult & CheckpointAdvisory = {
      checkpoint_id: checkpoint._id,
      branch_id: branchId,
      extracted: normalized.map((candidate) => ({
        text: candidate.text,
        kind: candidate.kind,
      })),
    };
    const forkSuggestion = await this.divergenceSuggestion(branchId);
    if (forkSuggestion.shouldSuggest) {
      result.fork_suggestion = forkSuggestion;
    }
    return result;
  }

  async forkFrom(input: ForkFromInput): Promise<ForkFromResult> {
    const branch = await createForkBranch({
      trunk: this.trunk,
      checkpointId: input.checkpoint_id,
      topic: input.topic,
      name: input.name,
    });
    const graph = await loadGraph(this.trunk);
    return {
      branch_id: branch._id,
      name: branch.name,
      resume_command: `resume(${JSON.stringify(branch._id)})`,
      graph: graph.graph,
    };
  }

  async resume(input: ResumeInput): Promise<ResumeResult> {
    const byBranch = await this.trunk.branches.findOne({ _id: input.id });
    const checkpoint = byBranch ? null : await checkpointById(this.trunk, input.id);
    const branch = byBranch ?? (checkpoint
      ? await getBranchOrThrow(this.trunk, checkpoint.branch_id)
      : null);
    if (!branch) {
      throw new Error(`Unknown branch or checkpoint: ${input.id}`);
    }

    const ancestry = checkpoint
      ? await ancestryForCheckpoint(this.trunk, checkpoint._id)
      : await ancestryForBranch(this.trunk, branch);
    const brief = distillBrief({ topic: branch.topic, checkpoints: ancestry });
    const memories = await this.memory.recall(branch.topic, {
      branch_id: branch._id,
      k: DEFAULT_RECALL_K,
    });
    this.currentBranchId = branch._id;
    return {
      branch_id: branch._id,
      topic: branch.topic,
      brief,
      memories: formatResumeMemories(
        memories.filter((memory) => memory.scope === "trunk"),
      ),
    };
  }

  async remember(input: RememberInput): Promise<RememberResult> {
    const branchId = await this.requireCurrentBranchId();
    const latest =
      (await latestCheckpointForBranch(this.trunk, branchId)) ??
      (await createImplicitMemoryCheckpoint(this.trunk, branchId, input.text));
    const scope = input.kind === "fact" ? "trunk" : branchId;
    const memoryId = await this.memory.write({
      text: input.text,
      tags: input.tags ?? [],
      kind: input.kind,
      scope,
      source_checkpoint: latest._id,
      confidence: 1,
    });
    return {
      memory_id: memoryId,
      kind: input.kind,
      scope,
      deduped: false,
    };
  }

  async promote(input: PromoteInput): Promise<PromoteResult> {
    await this.memory.promote(input.memory_id);
    return {
      memory_id: input.memory_id,
      promoted: true,
    };
  }

  async recall(input: RecallInput): Promise<RecallResult> {
    const branchId = await this.requireCurrentBranchId();
    const memories = await this.memory.recall(input.query, {
      branch_id: branchId,
      k: input.k ?? DEFAULT_RECALL_K,
      tags: input.tags,
    });
    return {
      memories: memories.map((memory) => ({
        text: memory.text,
        kind: memory.kind,
        confidence: memory.confidence,
        source_checkpoint: memory.source_checkpoint,
      })),
    };
  }

  async listBranches(): Promise<ListBranchesResult> {
    await ensureMainBranch(this.trunk);
    const graph = await loadGraph(this.trunk);
    return {
      branches: summarizeBranches(graph.branches, graph.checkpoints),
      graph: graph.graph,
    };
  }

  private async requireCurrentBranchId(): Promise<BranchId> {
    if (this.currentBranchId) return this.currentBranchId;
    const branch = await ensureMainBranch(this.trunk);
    this.currentBranchId = branch._id;
    return branch._id;
  }

  private async divergenceSuggestion(branchId: BranchId): Promise<DivergenceSuggestion> {
    const branch = await getBranchOrThrow(this.trunk, branchId);
    const messages = await this.trunk.messages
      .find({ branch_id: branchId })
      .sort({ ts: -1 })
      .limit(6)
      .toArray();
    return suggestDivergence({
      branchTopic: branch.topic,
      recentTurns: chronologicalContents(messages),
    });
  }
}

function chronologicalContents(messages: Message[]): string[] {
  return [...messages]
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .map((message) => message.content);
}

export function assertMemoryKind(value: string): MemoryKind {
  if (value === "fact" || value === "hypothesis") return value;
  throw new Error(`Invalid memory kind: ${value}`);
}
