import React, { useState, useMemo, useCallback } from 'react';
import { PredictionArrowProps } from '../../types';
import { getInitialTimeframes } from '../../api/binanceAPI';

const timeframeLabelCache = new Map<string, string>();
const timeframeSecondsCache = new Map<string, number>();

const getTimeframeLabel = (timeframeId: string): string => {
    if (timeframeLabelCache.has(timeframeId)) {
        return timeframeLabelCache.get(timeframeId)!;
    }

    const timeframes = getInitialTimeframes('BTCUSDT', false);
    const timeframe = timeframes.find(tf => tf.id === timeframeId);
    const label = timeframe?.label || timeframeId;

    timeframeLabelCache.set(timeframeId, label);
    return label;
};

const timeframeToSeconds = (timeframeId: string): number => {
    if (timeframeSecondsCache.has(timeframeId)) {
        return timeframeSecondsCache.get(timeframeId)!;
    }

    const match = timeframeId.match(/^(\d+)([smhdw])$/);
    if (!match) {
        timeframeSecondsCache.set(timeframeId, 0);
        return 0;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    let seconds = 0;
    switch (unit) {
        case 's': seconds = value; break;
        case 'm': seconds = value * 60; break;
        case 'h': seconds = value * 3600; break;
        case 'd': seconds = value * 86400; break;
        case 'w': seconds = value * 604800; break;
        default: seconds = 0;
    }

    timeframeSecondsCache.set(timeframeId, seconds);
    return seconds;
};

const PredictionArrow: React.FC<PredictionArrowProps> = ({ value, position, timeframeId, ticker, timeframesAtSameTime, propagationLevel }) => {
    const [showTooltip, setShowTooltip] = useState(false);

    const handleMouseEnter = useCallback(() => setShowTooltip(true), []);
    const handleMouseLeave = useCallback(() => setShowTooltip(false), []);

    const computedValues = useMemo(() => {
        if (value === 0 || value === null || value === undefined) {
            return null;
        }

        const isUp = value > 0;
        const color = isUp ? 'rgb(16, 185, 129)' : 'rgb(239, 68, 68)';
        const timeframeLabel = getTimeframeLabel(timeframeId);
        const absValue = Math.abs(value);
        const dotSize = Math.max(4, Math.min(8, 4 + (absValue / 10)));

        return { isUp, color, timeframeLabel, absValue, dotSize };
    }, [value, timeframeId]);

    if (!computedValues) {
        return null;
    }

    const { isUp, color, timeframeLabel, absValue, dotSize } = computedValues;

    const dotStyle: React.CSSProperties = {
        position: 'absolute',
        left: `${position.x + 1}px`,
        top: `${position.y + 2}px`,
        transform: 'translate(-50%, -50%)',
        backgroundColor: color,
        width: `${dotSize}px`,
        height: `${dotSize}px`,
        borderRadius: '50%',
        zIndex: 1,
        boxShadow: '0 0 4px rgba(0, 0, 0, 0.3)',
        cursor: 'pointer',
        opacity: Math.max(0.8, Math.min(1, absValue / 10)), // Higher base opacity for visibility
    };

    const tooltipStyle: React.CSSProperties = {
        position: 'absolute',
        left: `${position.x + 1}px`,
        top: `${position.y - 20}px`,
        transform: 'translate(-50%, -100%)',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        whiteSpace: 'nowrap',
        zIndex: 10,
        pointerEvents: 'none',
        border: `1px solid ${color}`,
    };

    const timeframeOffset = useMemo(() => {
        const baseOffset = 12;

        if (!timeframesAtSameTime || timeframesAtSameTime.length <= 1) {
            return baseOffset;
        }

        const sortedTimeframes = [...timeframesAtSameTime]
            .map(tf => ({ id: tf, seconds: timeframeToSeconds(tf) }))
            .sort((a, b) => a.seconds - b.seconds);

        const rank = sortedTimeframes.findIndex(tf => tf.id === timeframeId);

        if (rank === -1) return baseOffset;

        return baseOffset + (rank * 10);
    }, [timeframeId, timeframesAtSameTime]);

    const labelStyle: React.CSSProperties = {
        position: 'absolute',
        left: `${position.x + 1}px`,
        top: `${position.y - timeframeOffset}px`,
        transform: 'translate(-50%, -100%)',
        color: color,
        fontSize: '12px',
        fontWeight: 'bold',
        zIndex: 2,
        pointerEvents: 'none',
        fontFamily: 'monospace',
    };

    return (
        <>
            <div
                style={dotStyle}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            />
            <div style={labelStyle}>
                {timeframeId}
            </div>
            {showTooltip && (
                <div style={tooltipStyle}>
                    {ticker} {timeframeLabel}: {isUp ? '^' : 'v'} {absValue}%
                </div>
            )}
        </>
    );
};

export default React.memo(PredictionArrow);