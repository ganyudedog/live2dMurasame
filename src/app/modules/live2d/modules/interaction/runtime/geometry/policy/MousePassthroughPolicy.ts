export interface MousePassthroughPolicyInput {
  inputActive: boolean;
  ignoreMouse: boolean;
  pointerInsideModel: boolean;
  pointerInsideBubble: boolean;
  pointerInsideHandle: boolean;
  dragHandleHover: boolean;
  dragHandleActive: boolean;
}

export interface MousePassthroughPolicyResult {
  shouldCapture: boolean;
  shouldPassthrough: boolean;
}

/**
 * 纯计算：根据交互快照决定窗口是否应进入鼠标穿透。
 */
export const resolveMousePassthroughPolicy = ({
  inputActive,
  ignoreMouse,
  pointerInsideModel,
  pointerInsideBubble,
  pointerInsideHandle,
  dragHandleHover,
  dragHandleActive,
}: MousePassthroughPolicyInput): MousePassthroughPolicyResult => {
  const shouldCapture = inputActive || (!ignoreMouse && (
    pointerInsideModel
    || pointerInsideBubble
    || pointerInsideHandle
    || dragHandleHover
    || dragHandleActive
  ));

  return {
    shouldCapture,
    shouldPassthrough: !shouldCapture,
  };
};
