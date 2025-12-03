/**
 * PetCanvasEntry
 *
 * 入口包装：后续替换应用入口使用此文件，
 * 以便逐步将外部依赖从 `PetCanvas` 切换为 `PetCanvasRoot`。
 * 当前仅默认导出 Root。
 */
import PetCanvasRoot from './PetCanvasRoot';
export default PetCanvasRoot;
