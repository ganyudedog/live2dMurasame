interface MouseFollowRuntime {
  on(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
}

/** 在 SDK saveParameters 之后、顶点计算之前混合，避免鼠标值被保存为下一帧的本地基线。 */
export const attachMouseFollowRuntime = (runtime: MouseFollowRuntime,
  getWeight: () => number, apply: (weight: number) => void): (() => void) => {
  const update = () => {
    const weight = getWeight();
    // 预览与对话动作进入、播放、回退阶段均为零，不执行任何鼠标参数写入。
    if (weight > 0) apply(weight);
  };
  runtime.on('beforeModelUpdate', update);
  return () => runtime.off('beforeModelUpdate', update);
};
