import { computeContextZone, type ContextZoneConstants, type ContextZoneInput, type ContextZoneResult } from '../../../logic/contextZone/contextZoneEngine';

export interface ContextZoneLayoutSolverInput extends ContextZoneInput {
  constants: ContextZoneConstants;
}

/**
 * 纯计算：根据容器、模型和屏幕边缘信息，求解上下文区布局。
 *
 * 当前阶段复用既有 contextZoneEngine，先把调用点从 PetCanvas 中收出去，
 * 后续再继续把常量策略和命中策略也统一迁入 geometry runtime。
 */
export const solveContextZoneLayout = ({ constants, ...input }: ContextZoneLayoutSolverInput): ContextZoneResult => {
  return computeContextZone(input, constants);
};