import React, { memo } from 'react';

type ChatBubbleProps = {
    text: string;
    side: 'start' | 'end';
    tail: { y: number; size?: number };
    maxWidth?: number | string; // 若未提供，将使用 CSS 变量 --bubble-max-width
    className?: string;
    style?: React.CSSProperties;
};

const DEFAULT_TAIL_SIZE = 10;

/**
 * 对称的聊天气泡组件（不依赖 DaisyUI），支持：
 * - 左右侧（start/end）一致的布局
 * - 尾巴在左右边，纵向自由定位（tail.y）
 * - 可选缩放与最大宽度
 * - 文本传入
 *
 * 定位说明：
 * - 组件内部不负责根据“模型嘴巴坐标”定位，仅提供尾巴在气泡盒子内的 y 位置。
 * - 在 PetCanvas 中，计算并设置气泡的 top/left，使尾巴尖与模型嘴巴 y 共线即可。
 */
export const ChatBubble: React.FC<ChatBubbleProps> = ({
    text,
    side,
    tail,
    maxWidth,
    className,
    style,
}) => {
    const tailSize = tail.size ?? DEFAULT_TAIL_SIZE;
    const isLeft = side === 'start';

    // 外层容器负责 scale，避免内部尺寸与定位偏差
    const containerStyle: React.CSSProperties = {
        // 不在组件内部做绝对定位或缩放，由父容器控制
        ...style,
    };

    // 气泡主体盒子：使用对称的 padding 与圆角
    const resolvedMaxWidth: number | string = maxWidth ?? 'var(--bubble-max-width, 260px)';
    const sidePadding = tailSize + 1; // 包含轻微高光的占位，确保尾巴不越界
    // 避免同时混用 padding 与 paddingLeft/Right 导致 React 警告：使用完全展开的 padding 属性
    const baseHorizPadding = 3;
    const bubbleStyle: React.CSSProperties = {
        position: 'relative',
        display: 'inline-block',
        maxWidth: resolvedMaxWidth,
        background: '#0f172a', // 近似 DaisyUI dark bubble
        color: '#fff',
        borderRadius: 10,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: isLeft ? baseHorizPadding : baseHorizPadding + sidePadding,
        paddingRight: isLeft ? baseHorizPadding + sidePadding : baseHorizPadding,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        // 为避免左右内部留白不一致，不做额外对齐，只由外层决定 side
    };

    // 尾巴（箭头）样式：对称的三角形，尖端沿 y 定位
    // 使用两个层叠元素以获得描边/阴影效果，保持左右一致
    const tailCommon: React.CSSProperties = {
        position: 'absolute',
        width: 0,
        height: 0,
        top: tail.y - tailSize, // 以尖端共线，向上回退 size 长度
        // 约束尾巴 Y 在盒子内，溢出由外层定位避免
    };

    // 主三角形
    const tailPrimary: React.CSSProperties = {
        ...tailCommon,
        width: tailSize,
        height: tailSize * 2,
        background: '#0f172a',
        ...(isLeft
            ? {
                right: 0,
                clipPath: 'polygon(100% 50%, 0 0, 0 100%)',
            }
            : {
                left: 0,
                clipPath: 'polygon(0 50%, 100% 0, 100% 100%)',
            }),
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
    };

    // 轻微的描边/高光，保证左右一致（可选）
    const tailHighlight: React.CSSProperties = {
        ...tailCommon,
        width: Math.max(1, Math.floor(tailSize * 0.5)),
        height: tailSize * 2 - 2,
        background: 'rgba(255,255,255,0.06)',
        ...(isLeft
            ? {
                right: 1,
                clipPath: 'polygon(100% 50%, 0 0, 0 100%)',
            }
            : {
                left: 1,
                clipPath: 'polygon(0 50%, 100% 0, 100% 100%)',
            }),
    };

    return (
        <div className={className} style={containerStyle} data-side={side}>
            <div style={bubbleStyle}>
                {/* 尾巴层：先高光后主体，保持与盒子完全对称 */}
                <div style={tailHighlight} />
                <div style={tailPrimary} />
                {/* 文本内容 */}
                <div
                    style={{
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        lineHeight: 1.4,
                        fontSize: 14,
                    }}
                >
                    {text}
                </div>
            </div>
        </div>
    );
};

export default memo(ChatBubble);