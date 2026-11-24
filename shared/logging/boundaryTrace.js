export const boundaryNames = ['config.update', 'conversation.turn', 'cli.invoke', 'plugin.cli.register', 'plugin.conversation', 'plugin.runtime'];

export const isBoundaryName = (value) => boundaryNames.includes(value);

/** 前后端不共享日志对象。血缘只看这份身份是否相同。 */
export const isBoundaryTrace = (value) => Boolean(value)
  && typeof value === 'object'
  && typeof value.traceId === 'string'
  && value.traceId.length > 0
  && value.traceId.length <= 200
  && isBoundaryName(value.boundary);

/** 配置更新的 IPC 载体。没有 trace 时，输入本身就是要保存的补丁。 */
export const readConfigUpdate = (input) => {
  if (input && typeof input === 'object' && !Array.isArray(input)
    && input.patch && typeof input.patch === 'object' && !Array.isArray(input.patch)
    && isBoundaryTrace(input.trace)) {
    return { patch: input.patch, trace: input.trace };
  }
  return {
    patch: input && typeof input === 'object' && !Array.isArray(input) ? input : {},
    trace: null,
  };
};
