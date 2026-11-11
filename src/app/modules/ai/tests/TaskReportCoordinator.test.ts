import { describe, expect, it, vi } from 'vitest';
import type { TaskEvent } from '../../../../../shared/cli/contracts';
import { agentTask } from '../../../../test/fixtures/agentTask';
import { TaskReportCoordinator } from '../service/TaskReportCoordinator';

describe('online task reports', () => {
  it.each(['succeeded', 'failed', 'cancelled', 'interrupted'] as const)('reports %s once after acknowledgement, ignoring unrelated tasks', (status) => {
    let deliver!: (event: TaskEvent) => void;
    const stop = vi.fn();
    const report = vi.fn();
    const coordinator = new TaskReportCoordinator<string>((_origin, listener) => { deliver = listener; return stop; }, report);
    const task = agentTask();
    coordinator.track(task, 'original conversation');
    deliver({ task: agentTask({ id: 'someone-else', status }), sequence: 2 });
    expect(report).not.toHaveBeenCalled();
    const completed = agentTask({ status, summary: 'execution result', sequence: 3 });
    deliver({ task: completed, sequence: 3 });
    deliver({ task, sequence: 1 });
    coordinator.release('unrelated-request');
    expect(report).not.toHaveBeenCalled();
    coordinator.release(task.requestId);
    expect(report).toHaveBeenCalledExactlyOnceWith(completed, 'original conversation');
    expect(stop).toHaveBeenCalledOnce();
    deliver({ task: completed, sequence: 3 });
    coordinator.track(completed, 'original conversation');
    coordinator.release(task.requestId);
    expect(report).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it('waits for terminal status after acknowledgement and unsubscribes on disposal', () => {
    const listeners: Array<(event: TaskEvent) => void> = [];
    const stop = vi.fn();
    const report = vi.fn();
    const coordinator = new TaskReportCoordinator((_, listener) => { listeners.push(listener); return stop; }, report);
    const task = agentTask();
    coordinator.track(task, {});
    coordinator.release(task.requestId);
    expect(report).not.toHaveBeenCalled();
    listeners[0]({ task: agentTask({ status: 'succeeded', sequence: 2 }), sequence: 2 });
    expect(report).toHaveBeenCalledOnce();
    coordinator.track(agentTask({ id: 'task-2' }), {});
    coordinator.release(task.requestId);
    coordinator.dispose();
    listeners[1]({ task: agentTask({ id: 'task-2', status: 'succeeded', sequence: 2 }), sequence: 2 });
    expect(report).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
