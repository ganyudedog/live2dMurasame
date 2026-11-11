import type { AgentTask } from '../../../../../../../shared/cli/contracts';
import { boundedToolText } from './toolContext';

export interface TaskReport { task: AgentTask; userText: string }
export const taskReportId = (task: AgentTask): string => `report:${task.id}`;
export const TASK_REPORT_CUE = '系统事件：先前委托的任务已结束。请根据执行结果主动向用户简短汇报，保持当前角色语气；明确成功、失败、取消或中断，不执行新操作，不把这条事件当成用户的新请求。';
export const taskReportContext = ({ task, userText }: TaskReport): string => JSON.stringify({
  taskId: task.id, workspaceId: task.workspaceId, status: task.status,
  ...(task.error ? { error: boundedToolText(task.error, 2000) } : {}),
  originalRequest: boundedToolText(userText, 2000), summary: boundedToolText(task.summary, 12000),
});
