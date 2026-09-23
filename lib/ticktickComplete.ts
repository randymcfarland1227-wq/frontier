/** Client for TickTick Open API complete via frontier-work-room Worker.
 * Token stays on the Worker — never ship TICKTICK_ACCESS_TOKEN in the Pages bundle.
 */

const WORKER_COMPLETE_URL =
  'https://frontier-work-room.randymcfarland1227.workers.dev/api/ticktick/complete';

export type CompleteTickTickResult =
  | { ok: true }
  | { ok: false; reason?: string; error?: string; status?: number };

/** Parse projectId from task.projectId or originUrl `#p/{projectId}/tasks/{taskId}`. */
export function projectIdFromTask(task: {
  projectId?: string;
  originUrl?: string;
  id?: string;
}): string | null {
  if (task.projectId && String(task.projectId).trim()) {
    return String(task.projectId).trim();
  }
  const url = task.originUrl || '';
  const m = url.match(/#p\/([^/]+)\/tasks\/([^/?#]+)/);
  if (m?.[1]) return m[1];
  return null;
}

export function isTickTickHabit(task: { id?: string; kind?: string }): boolean {
  if (task.kind === 'habit') return true;
  return String(task.id || '').startsWith('habit-');
}

export async function completeTickTickTask(opts: {
  taskId: string;
  projectId: string;
}): Promise<CompleteTickTickResult> {
  const { taskId, projectId } = opts;
  if (!taskId || !projectId) {
    return { ok: false, error: 'missing_ids' };
  }
  if (taskId.startsWith('habit-')) {
    return { ok: false, reason: 'habit' };
  }

  try {
    const res = await fetch(WORKER_COMPLETE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, projectId }),
    });
    let data: CompleteTickTickResult & { status?: number } = { ok: false };
    try {
      data = (await res.json()) as CompleteTickTickResult;
    } catch {
      /* non-JSON */
    }
    if (res.ok && data && (data as { ok?: boolean }).ok) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: (data as { reason?: string }).reason,
      error: (data as { error?: string }).error || `http_${res.status}`,
      status: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'network_error',
    };
  }
}

/** Fire-and-forget complete with one retry; keeps hub dismiss on failure. */
export function completeTickTickTaskInBackground(opts: {
  taskId: string;
  projectId: string;
}): void {
  void (async () => {
    let result = await completeTickTickTask(opts);
    if (!result.ok && result.reason !== 'habit') {
      result = await completeTickTickTask(opts);
    }
    if (!result.ok) {
      console.warn(
        '[Life Hub] TickTick complete failed (task stays dismissed locally)',
        { taskId: opts.taskId, projectId: opts.projectId, ...result },
      );
    }
  })();
}
