import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';
import { CandlestickData, ChartContainerProps, PredictionEntry, ArrowPosition, Propagation, InitialIndicator } from '../../types';
import { fetchKlineData, subscribeToUpdates, getCurrentData, parseAndValidateTimeframeInput, calculateDataLimit } from '../../api/binanceAPI';
import { subscribeToPredictionUpdates, getCurrentPredictions, subscribeToViewUpdates, getAvailableTimeframes } from '../../api/sumtymeAPI';
import PredictionArrow from './PredictionArrow';

const formatDateTime = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    return date.toISOString().slice(0, 19).replace('T', ' ');
};

const parseDateTime = (datetime: string): number => {
    return Math.floor(new Date(datetime.replace(' ', 'T') + 'Z').getTime() / 1000);
};

const parseCustomDateTime = (dateStr: string): Date | null => {
    if (!dateStr || dateStr.trim() === '') return null;

    // Try parsing YYYY-MM-DD HH:MM:SS format as UTC
    const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
    if (match) {
        const [, year, month, day, hour, minute, second] = match;
        return new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second)));
    }

    // Fallback to standard parsing
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
};

const getAlignedTimestamp = (timestamp: number, interval: string): number => {
    // Validate input timestamp
    if (!timestamp || timestamp <= 0 || !isFinite(timestamp)) {
        console.error('Invalid timestamp:', timestamp);
        return Math.floor(Date.now() / 1000); // Return current time as fallback
    }

    // Validate interval format
    if (!interval || typeof interval !== 'string' || interval.length < 2) {
        console.error('Invalid interval format:', interval);
        return timestamp; // Return original timestamp as fallback
    }

    // Create date object in UTC
    const date = new Date(timestamp * 1000);

    // Validate date creation
    if (isNaN(date.getTime())) {
        console.error('Invalid date created from timestamp:', timestamp);
        return Math.floor(Date.now() / 1000);
    }

    // Extract interval value and unit
    const intervalValue = parseInt(interval.slice(0, -1), 10);
    const intervalUnit = interval.slice(-1).toLowerCase();

    // Validate interval value
    if (isNaN(intervalValue) || intervalValue <= 0) {
        console.error('Invalid interval value:', interval);
        return timestamp;
    }

    try {
        switch (intervalUnit) {
            case 's': {
                // Seconds - align to the interval boundary
                const seconds = date.getUTCSeconds();
                const alignedSeconds = Math.floor(seconds / intervalValue) * intervalValue;
                date.setUTCSeconds(alignedSeconds, 0);
                break;
            }

            case 'm': {
                // Minutes - align to the interval boundary
                const minutes = date.getUTCMinutes();
                const alignedMinutes = Math.floor(minutes / intervalValue) * intervalValue;
                date.setUTCMinutes(alignedMinutes, 0, 0);
                break;
            }

            case 'h': {
                // Hours - align to the interval boundary
                const hours = date.getUTCHours();
                const alignedHours = Math.floor(hours / intervalValue) * intervalValue;
                date.setUTCHours(alignedHours, 0, 0, 0);
                break;
            }

            case 'd': {
                // Days - align to midnight UTC, then adjust for multi-day intervals
                date.setUTCHours(0, 0, 0, 0);

                // For multi-day intervals (e.g., 3d), align to epoch
                if (intervalValue > 1) {
                    const epochTime = new Date(Date.UTC(1970, 0, 1, 0, 0, 0, 0));
                    const daysSinceEpoch = Math.floor((date.getTime() - epochTime.getTime()) / (24 * 60 * 60 * 1000));
                    const alignedDays = Math.floor(daysSinceEpoch / intervalValue) * intervalValue;
                    date.setTime(epochTime.getTime() + (alignedDays * 24 * 60 * 60 * 1000));
                }
                break;
            }

            case 'w': {
                // Weeks - align to Monday at midnight UTC
                const dayOfWeek = date.getUTCDay();
                const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
                date.setUTCDate(date.getUTCDate() - daysToMonday);
                date.setUTCHours(0, 0, 0, 0);

                // For multi-week intervals, align to a reference Monday
                if (intervalValue > 1) {
                    // Use a known Monday as reference (e.g., Jan 1, 2024 was a Monday)
                    const referenceMonday = new Date(Date.UTC(2024, 0, 1, 0, 0, 0, 0));
                    const weeksSinceReference = Math.floor((date.getTime() - referenceMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));
                    const alignedWeeks = Math.floor(weeksSinceReference / intervalValue) * intervalValue;
                    date.setTime(referenceMonday.getTime() + (alignedWeeks * 7 * 24 * 60 * 60 * 1000));
                }
                break;
            }

            case 'M': {
                // Months - align to first day of month at midnight UTC
                date.setUTCDate(1);
                date.setUTCHours(0, 0, 0, 0);

                // For multi-month intervals, align to a reference point
                if (intervalValue > 1) {
                    const year = date.getUTCFullYear();
                    const month = date.getUTCMonth();
                    const monthsSince2024 = (year - 2024) * 12 + month;
                    const alignedMonths = Math.floor(monthsSince2024 / intervalValue) * intervalValue;
                    const newYear = 2024 + Math.floor(alignedMonths / 12);
                    const newMonth = alignedMonths % 12;
                    date.setUTCFullYear(newYear, newMonth, 1);
                }
                break;
            }

            default: {
                console.warn(`Unsupported interval unit: ${intervalUnit}. Supported units: s, m, h, d, w, M`);
                return timestamp; // Return original timestamp for unsupported units
            }
        }

        // Final validation of the aligned date
        const alignedTimestamp = Math.floor(date.getTime() / 1000);
        if (!isFinite(alignedTimestamp) || alignedTimestamp <= 0) {
            console.error('Invalid aligned timestamp calculated:', alignedTimestamp);
            return timestamp;
        }

        return alignedTimestamp;

    } catch (error) {
        console.error('Error in getAlignedTimestamp:', error, 'interval:', interval, 'timestamp:', timestamp);
        return timestamp; // Return original timestamp on error
    }
};

const ChartContainer: React.FC<ChartContainerProps> = ({
    timeframe,
    height,
    symbol,
    fixLeftEdge = true,
    onTimeframeUpdate,
    showHistoricalPerformance = false,
    showAllInsights = false,
    startDate,
    endDate,
    selectedTimeframes,
    propagations = [],
    initialIndicators = [],
    selectedPropagationLevel = null
}) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const overlayContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const [currentData, setCurrentData] = useState<CandlestickData[]>([]);
    const [lastPrice, setLastPrice] = useState<CandlestickData | null>(null);
    const [predictions, setPredictions] = useState<PredictionEntry[]>(getCurrentPredictions(timeframe.binanceInterval, showHistoricalPerformance, symbol)); const [chartDimensions, setChartDimensions] = useState({ width: 0, height: 0 });
    const [viewUpdateTrigger, setViewUpdateTrigger] = useState(0);
    const [arrowPositions, setArrowPositions] = useState<ArrowPosition[]>([]);
    const [isMobile, setIsMobile] = useState(false);

    const filterPredictionsByDateAndTimeframe = (preds: PredictionEntry[]): PredictionEntry[] => {
        let filtered = preds;

        if (selectedTimeframes && selectedTimeframes.length === 0) {
            return [];
        }

        if (startDate || endDate) {
            const start = startDate ? (parseCustomDateTime(startDate) || new Date(0)) : new Date(0);
            const end = endDate ? (parseCustomDateTime(endDate) || new Date(8640000000000000)) : new Date(8640000000000000);

            filtered = filtered.filter(pred => {
                const predDate = new Date(pred.datetime.replace(' ', 'T') + 'Z');
                return predDate >= start && predDate <= end;
            });
        }

        if (selectedTimeframes && selectedTimeframes.length > 0) {
            filtered = filtered.filter(pred => selectedTimeframes.includes(pred.timeframeId));
        }

        if (selectedPropagationLevel !== null && propagations.length > 0) {
            const propagationIdToMaxLevel = new Map<string, number>();

            propagations.forEach(prop => {
                const currentMax = propagationIdToMaxLevel.get(prop.propagation_id) || 0;
                if (prop.propagation_level > currentMax) {
                    propagationIdToMaxLevel.set(prop.propagation_id, prop.propagation_level);
                }
            });

            const filteredPropagationIds = Array.from(propagationIdToMaxLevel.entries())
                .filter(([_, maxLevel]) => maxLevel >= selectedPropagationLevel)
                .map(([id, _]) => id);

            const validPropagations = propagations.filter(prop =>
                filteredPropagationIds.includes(prop.propagation_id)
            );

            const validPredictionKeys = new Set<string>();

            validPropagations.forEach(prop => {
                validPredictionKeys.add(`${prop.datetime}|${prop.lower_freq}|${prop.trend_type}`);
            });

            filteredPropagationIds.forEach(propId => {
                const match = propId.match(/^Prop_(\d+)$/);
                if (match) {
                    const index = parseInt(match[1], 10) - 1;
                    if (index >= 0 && index < initialIndicators.length) {
                        const initialInd = initialIndicators[index];
                        validPredictionKeys.add(`${initialInd.datetime}|${initialInd.timeframe}|${initialInd.trend_type}`);
                    }
                }
            });

            filtered = filtered.filter(pred => {
                const predKey = `${pred.datetime}|${pred.timeframeId}|${pred.value}`;
                return validPredictionKeys.has(predKey);
            });
        }

        return filtered;
    };

    const filterKlinesByDateRange = (klines: CandlestickData[]): CandlestickData[] => {
        if (!startDate && !endDate) {
            return klines;
        }

        const start = startDate ? (parseCustomDateTime(startDate) || new Date(0)) : new Date(0);
        const end = endDate ? (parseCustomDateTime(endDate) || new Date(8640000000000000)) : new Date(8640000000000000);

        console.log('[ChartContainer] Filtering klines:', {
            startDate,
            endDate,
            parsedStart: start,
            parsedEnd: end,
            totalKlines: klines.length,
            firstKlineTime: klines.length > 0 ? new Date(klines[0].time * 1000).toISOString() : 'none',
            lastKlineTime: klines.length > 0 ? new Date(klines[klines.length - 1].time * 1000).toISOString() : 'none'
        });

        const filtered = klines.filter(kline => {
            const klineDate = new Date(kline.time * 1000);
            return klineDate >= start && klineDate <= end;
        });

        console.log('[ChartContainer] Filtered result:', {
            originalCount: klines.length,
            filteredCount: filtered.length
        });

        return filtered;
    };

    // Timeframe input state
    const [timeframeInputValue, setTimeframeInputValue] = useState('');
    const [timeframeInputError, setTimeframeInputError] = useState('');
    const [isEditingTimeframe, setIsEditingTimeframe] = useState(false);

    // Initialize timeframe input value
    useEffect(() => {
        // Convert label back to input format
        const label = timeframe.label;
        if (label.includes('Minute')) {
            const value = label.replace(' Minutes', '').replace(' Minute', '');
            setTimeframeInputValue(`${value} M`);
        } else if (label.includes('Hour')) {
            const value = label.replace(' Hours', '').replace(' Hour', '');
            setTimeframeInputValue(`${value} H`);
        } else if (label.includes('Day')) {
            const value = label.replace(' Days', '').replace(' Day', '');
            setTimeframeInputValue(`${value} D`);
        } else if (label.includes('Week')) {
            const value = label.replace(' Weeks', '').replace(' Week', '');
            setTimeframeInputValue(`${value} W`);
        } else {
            setTimeframeInputValue(label);
        }
    }, [timeframe.label]);

    // Check if we're on mobile
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 500);
        };

        checkMobile();
        window.addEventListener('resize', checkMobile);

        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const handleTimeframeInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTimeframeInputValue(e.target.value);
        setTimeframeInputError('');
    };

    const handleTimeframeInputSubmit = () => {
        if (!onTimeframeUpdate) return;

        const parseResult = parseAndValidateTimeframeInput(timeframeInputValue);

        if (!parseResult.success) {
            setTimeframeInputError(parseResult.error || 'Invalid input');
            // Revert to original value
            const label = timeframe.label;
            if (label.includes('Minute')) {
                const value = label.replace(' Minutes', '').replace(' Minute', '');
                setTimeframeInputValue(`${value} M`);
            } else if (label.includes('Hour')) {
                const value = label.replace(' Hours', '').replace(' Hour', '');
                setTimeframeInputValue(`${value} H`);
            } else {
                setTimeframeInputValue(label);
            }
            return;
        }
        // NEW: Check if the timeframe is the same as the current one
        if (parseResult.binanceInterval === timeframe.binanceInterval) {
            setIsEditingTimeframe(false);
            setTimeframeInputError('');
            return; // Exit early - no need to update
        }
        // Calculate the new dataLimit based on the formula
        const newDataLimit = calculateDataLimit(parseResult.binanceInterval!);

        // Apply 16x multiplier if in historical performance mode
        const finalDataLimit = showHistoricalPerformance ? newDataLimit * 2 : newDataLimit;

        // Create updated timeframe config
        const updatedTimeframe = {
            ...timeframe,
            binanceInterval: parseResult.binanceInterval!,
            label: parseResult.label!,
            wsEndpoint: `${symbol.toLowerCase()}@kline_${parseResult.binanceInterval}`,
            dataLimit: finalDataLimit,
        };

        onTimeframeUpdate(updatedTimeframe);
        setIsEditingTimeframe(false);
    };

    const handleTimeframeInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleTimeframeInputSubmit();
        } else if (e.key === 'Escape') {
            setIsEditingTimeframe(false);
            setTimeframeInputError('');
            // Revert to original value
            const label = timeframe.label;
            if (label.includes('Minute')) {
                const value = label.replace(' Minutes', '').replace(' Minute', '');
                setTimeframeInputValue(`${value} M`);
            } else if (label.includes('Hour')) {
                const value = label.replace(' Hours', '').replace(' Hour', '');
                setTimeframeInputValue(`${value} H`);
            } else {
                setTimeframeInputValue(label);
            }
        }
    };

    // Function to get interval minutes for a timeframe
    const getIntervalMinutes = (timeframeId: string): number => {
        const value = parseInt(timeframeId.replace(/[a-zA-Z]/g, ''));
        const unit = timeframeId.replace(/[0-9]/g, '');

        switch (unit) {
            case 'm': return value;
            case 'h': return value * 60;
            case 'd': return value * 60 * 24;
            default: return value;
        }
    };

    // Function to detect "change ending" periods (3+ consecutive intervals with no predictions)
    const detectChangeEndings = (allPredictions: PredictionEntry[]): Array<{
        timeframeId: string;
        datetime: string;
        endTime: string;
    }> => {
        const changeEndings: Array<{
            timeframeId: string;
            datetime: string;
            endTime: string;
        }> = [];

        // Group all predictions (including 0 values) by timeframe
        const predictionsByTimeframe: Record<string, PredictionEntry[]> = {};

        // Include predictions from all timeframes, including those with value 0
        const availableTimeframes = getAvailableTimeframes(symbol);
        availableTimeframes.forEach(interval => {
            const intervalPredictions = getCurrentPredictions(interval, showHistoricalPerformance, symbol);
            // Get ALL predictions including 0s from the service
            predictionsByTimeframe[interval] = intervalPredictions.sort((a, b) =>
                new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
            );
        });

        // Analyze each timeframe for gaps
        Object.keys(predictionsByTimeframe).forEach(timeframeId => {
            const timeframePredictions = predictionsByTimeframe[timeframeId];
            const intervalMinutes = getIntervalMinutes(timeframeId);

            let consecutiveZeros = 0;
            let gapStartTime: string | null = null;

            timeframePredictions.forEach((prediction, index) => {
                if (prediction.value === 0) {
                    consecutiveZeros++;
                    if (gapStartTime === null) {
                        gapStartTime = prediction.datetime;
                    }
                } else {
                    // Non-zero prediction found, check if we had a gap. TODO: Think further about functionality
                    if (consecutiveZeros >= 1000000 && gapStartTime) {
                        // Calculate end time of the gap
                        const gapStart = new Date(gapStartTime.replace(' ', 'T') + 'Z');
                        const gapEnd = new Date(gapStart.getTime() + (consecutiveZeros * intervalMinutes * 60 * 1000));

                        changeEndings.push({
                            timeframeId,
                            datetime: gapStartTime,
                            endTime: formatDateTime(Math.floor(gapEnd.getTime() / 1000))
                        });
                    }
                    consecutiveZeros = 0;
                    gapStartTime = null;
                }
            });

            // Check for gap at the end of data
            if (consecutiveZeros >= 3 && gapStartTime) {
                const gapStart = new Date(gapStartTime.replace(' ', 'T') + 'Z');
                const gapEnd = new Date(gapStart.getTime() + (consecutiveZeros * intervalMinutes * 60 * 1000));

                changeEndings.push({
                    timeframeId,
                    datetime: gapStartTime,
                    endTime: formatDateTime(Math.floor(gapEnd.getTime() / 1000))
                });
            }
        });

        return changeEndings;
    };

    // Function to filter predictions to show only signal changes
    const filterSignalChanges = (predictions: PredictionEntry[]): PredictionEntry[] => {
        // Group predictions by timeframe
        const predictionsByTimeframe: Record<string, PredictionEntry[]> = {};

        predictions.forEach(prediction => {
            if (!predictionsByTimeframe[prediction.timeframeId]) {
                predictionsByTimeframe[prediction.timeframeId] = [];
            }
            predictionsByTimeframe[prediction.timeframeId].push(prediction);
        });

        // Filter each timeframe's predictions to show only signal changes
        const filteredPredictions: PredictionEntry[] = [];

        Object.keys(predictionsByTimeframe).forEach(timeframeId => {
            const timeframePredictions = predictionsByTimeframe[timeframeId]
                .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

            let lastSignal: number | null = null;

            timeframePredictions.forEach(prediction => {
                // Normalize prediction value to signal (+1 for positive, -1 for negative)
                const currentSignal = prediction.value > 0 ? 1 : -1;

                // Show this prediction if it's the first one or if signal changed
                if (lastSignal === null || currentSignal !== lastSignal) {
                    filteredPredictions.push(prediction);
                    lastSignal = currentSignal;
                }
            });
        });

        return filteredPredictions;
    };

    const calculateArrowPositions = (): ArrowPosition[] => {
        if (!chartRef.current || !seriesRef.current || !chartContainerRef.current || currentData.length === 0) {
            console.log('[ChartContainer] calculateArrowPositions early return:', {
                hasChart: !!chartRef.current,
                hasSeries: !!seriesRef.current,
                hasContainer: !!chartContainerRef.current,
                dataLength: currentData.length
            });
            return [];
        }

        const totalWidth = chartContainerRef.current.clientWidth;
        const rightPriceScale = chartRef.current.priceScale('right');
        const priceScaleWidth = rightPriceScale.width();
        const maxX = totalWidth - priceScaleWidth - 9;

        const dateAndTimeframeFiltered = filterPredictionsByDateAndTimeframe(predictions);
        const filteredPredictions = dateAndTimeframeFiltered.filter(prediction => prediction.value !== 0 && prediction.ticker === symbol);

        console.log('[ChartContainer] calculateArrowPositions:', {
            totalPredictions: predictions.length,
            symbol,
            filteredCount: filteredPredictions.length,
            showAllInsights,
            currentDataRange: currentData.length > 0 ? {
                first: currentData[0].time,
                last: currentData[currentData.length - 1].time,
                count: currentData.length
            } : null
        });

        const predictionsToShow = showAllInsights
            ? filteredPredictions
            : filterSignalChanges(filteredPredictions);

        console.log('[ChartContainer] predictionsToShow after filtering:', predictionsToShow.length);

        const changeEndings = detectChangeEndings(predictions);

        const arrowPositions: ArrowPosition[] = [];

        let matchedCount = 0;
        let unmatchedCount = 0;
        let outOfBoundsCount = 0;

        predictionsToShow.forEach((prediction, index) => {
            const timestamp = parseDateTime(prediction.datetime);

            let candlestick = currentData.find(d => d.time === timestamp);
            let matchedTimestamp = timestamp;

            if (!candlestick) {
                const candleTimes = currentData.map(d => d.time);
                const closestIndex = candleTimes.reduce((closest, time, index) => {
                    const currentDiff = Math.abs(time - timestamp);
                    const closestDiff = Math.abs(candleTimes[closest] - timestamp);
                    return currentDiff < closestDiff ? index : closest;
                }, 0);

                const timeDiff = Math.abs(candleTimes[closestIndex] - timestamp);

                if (index < 3) {
                    console.log(`[ChartContainer] Prediction ${index} matching:`, {
                        prediction,
                        timestamp,
                        closestCandleTime: candleTimes[closestIndex],
                        timeDiff,
                        willMatch: timeDiff <= 300
                    });
                }

                if (timeDiff <= 300) {
                    candlestick = currentData[closestIndex];
                    matchedTimestamp = candleTimes[closestIndex];
                }
            }

            if (!candlestick) {
                unmatchedCount++;
                return;
            }

            const coordinate = seriesRef.current!.priceToCoordinate(candlestick.open);
            const timeScale = chartRef.current!.timeScale();
            const timeCoordinate = timeScale.timeToCoordinate(matchedTimestamp);

            if (coordinate === null || timeCoordinate === null) {
                return;
            }

            if (timeCoordinate >= maxX || timeCoordinate < 0) {
                outOfBoundsCount++;
                return;
            }

            matchedCount++;

            arrowPositions.push({
                x: timeCoordinate,
                y: coordinate,
                value: prediction.value,
                datetime: prediction.datetime,
                timeframeId: prediction.timeframeId,
                ticker: prediction.ticker,
                isChangeEnding: false
            });
        });

        console.log('[ChartContainer] Arrow position results:', {
            predictionsToShow: predictionsToShow.length,
            matchedCount,
            unmatchedCount,
            outOfBoundsCount,
            finalArrowPositions: arrowPositions.length,
            samplePositions: arrowPositions.slice(0, 3)
        });

        if (!showAllInsights) {
            changeEndings.forEach(ending => {
                const timestamp = parseDateTime(ending.datetime);

                let candlestick = currentData.find(d => d.time === timestamp);
                let matchedTimestamp = timestamp;

                if (!candlestick) {
                    const candleTimes = currentData.map(d => d.time);
                    const closestIndex = candleTimes.reduce((closest, time, index) => {
                        const currentDiff = Math.abs(time - timestamp);
                        const closestDiff = Math.abs(candleTimes[closest] - timestamp);
                        return currentDiff < closestDiff ? index : closest;
                    }, 0);

                    if (Math.abs(candleTimes[closestIndex] - timestamp) <= 300) {
                        candlestick = currentData[closestIndex];
                        matchedTimestamp = candleTimes[closestIndex];
                    }
                }

                if (!candlestick) return;

                const coordinate = seriesRef.current!.priceToCoordinate(candlestick.open);
                const timeScale = chartRef.current!.timeScale();
                const timeCoordinate = timeScale.timeToCoordinate(matchedTimestamp);

                if (coordinate === null || timeCoordinate === null) return;

                if (timeCoordinate >= maxX || timeCoordinate < 0) return;

                arrowPositions.push({
                    x: timeCoordinate,
                    y: coordinate,
                    value: 0,
                    datetime: ending.datetime,
                    timeframeId: ending.timeframeId,
                    ticker: symbol,
                    isChangeEnding: true,
                    endTime: ending.endTime
                });
            });
        }

        return arrowPositions;
    };

    // Update arrow positions whenever dependencies change
    useEffect(() => {
        const newArrowPositions = calculateArrowPositions();
        setArrowPositions(newArrowPositions);
    }, [predictions, currentData, viewUpdateTrigger, chartDimensions, showAllInsights, propagations, initialIndicators, selectedPropagationLevel]);

    useEffect(() => {
        let resizeObserver: ResizeObserver | null = null;

        if (chartContainerRef.current) {
            const chartElement = chartContainerRef.current;
            chartElement.innerHTML = '';

            // Calculate dimensions with padding accounted for and ensure positive values
            const containerWidth = Math.max(1, chartElement.clientWidth - 2);
            const containerHeight = Math.max(1, chartElement.clientHeight - 2);

            // Responsive font sizes and spacing
            const fontSize = isMobile ? 8 : 10;
            const lineWidth = isMobile ? 1.5 : 1;
            const crosshairRadius = isMobile ? 3 : 4;

            const newChart = createChart(chartElement, {
                width: containerWidth,
                height: containerHeight,
                layout: {
                    background: { type: 'solid', color: '#292929' },
                    textColor: '#e0e0e0',
                    fontSize: fontSize,
                    fontFamily: 'Inter, sans-serif',
                },
                grid: {
                    vertLines: { color: '#919191', style: 1 },
                    horzLines: { color: '#919191', style: 1 },
                },
                timeScale: {
                    borderColor: '#242424',
                    timeVisible: true,
                    secondsVisible: !isMobile, // Hide seconds on mobile for cleaner look
                    borderVisible: true,
                    fixLeftEdge: fixLeftEdge,
                    fixRightEdge: true,
                    visible: true,
                    rightOffset: isMobile ? 5 : 10,
                },
                rightPriceScale: {
                    borderColor: '#242424',
                    borderVisible: true,
                    scaleMargins: {
                        top: 0.05,
                        bottom: isMobile ? 0.1 : 0.15,
                    },
                    visible: true,
                    width: isMobile ? 50 : 60,
                },
                crosshair: {
                    mode: 1,
                    vertLine: {
                        color: '#e0e0e0',
                        width: 1,
                        style: 2,
                        labelBackgroundColor: '#ffffff',
                    },
                    horzLine: {
                        color: '#e0e0e0',
                        width: 1,
                        style: 2,
                        labelBackgroundColor: '#ffffff',
                    },
                },
                handleScroll: {
                    mouseWheel: true,
                    pressedMouseMove: true,
                    horzTouchDrag: true,
                    vertTouchDrag: true,
                },
                handleScale: {
                    axisPressedMouseMove: {
                        time: true,
                        price: false,
                    },
                    mouseWheel: true,
                    pinch: true,
                },
                kineticScroll: {
                    mouse: true,
                    touch: true,
                },
            });

            const newSeries = newChart.addLineSeries({
                color: timeframe.color,
                lineWidth: lineWidth,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: crosshairRadius,
                crosshairMarkerBorderColor: timeframe.color,
                crosshairMarkerBackgroundColor: timeframe.color,
                priceLineVisible: false,
                lastValueVisible: false,
            });

            chartRef.current = newChart;
            seriesRef.current = newSeries;

            const timeScale = newChart.timeScale();
            timeScale.subscribeVisibleLogicalRangeChange(() => {
                setViewUpdateTrigger(prev => prev + 1);
            });

            setChartDimensions({
                width: containerWidth,
                height: containerHeight
            });

            resizeObserver = new ResizeObserver(entries => {
                if (entries[0] && chartRef.current) {
                    const { width, height: newHeight } = entries[0].contentRect;
                    // Ensure positive dimensions with padding accounted for
                    const adjustedWidth = Math.max(1, width - 4);
                    const adjustedHeight = Math.max(1, newHeight - 4);

                    chartRef.current.applyOptions({
                        width: adjustedWidth,
                        height: adjustedHeight
                    });
                    setChartDimensions({ width: adjustedWidth, height: adjustedHeight });
                    setViewUpdateTrigger(prev => prev + 1);
                }
            });

            resizeObserver.observe(chartElement);
        }

        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect();
            }

            if (chartRef.current) {
                chartRef.current.remove();
                chartRef.current = null;
            }
            seriesRef.current = null;
        };
    }, [height, timeframe.color, isMobile, fixLeftEdge]);

    // Update chart options when fixLeftEdge changes
    useEffect(() => {
        if (chartRef.current) {
            chartRef.current.applyOptions({
                timeScale: {
                    fixLeftEdge: fixLeftEdge,
                },
            });
        }
    }, [fixLeftEdge]);

    useEffect(() => {
        const initializeData = async () => {
            // Fetch data using the timeframe's dataLimit (which may be tripled)
            const historicalData = await fetchKlineData(timeframe, symbol, 0);
            if (seriesRef.current && historicalData.length > 0) {
                const filteredHistoricalData = filterKlinesByDateRange(historicalData);
                seriesRef.current.setData(
                    filteredHistoricalData.map(candle => ({
                        time: candle.time,
                        value: candle.open, // Changed from candle.close to candle.open
                    }))
                );
                setCurrentData(filteredHistoricalData);
                setLastPrice(historicalData[historicalData.length - 1]);

                // Set the visible range to show all data
                if (chartRef.current && historicalData.length > 1) {
                    const timeScale = chartRef.current.timeScale();
                    timeScale.fitContent();
                }

                // Update predictions based on whether the current timeframe supports predictions
                const allPredictions: PredictionEntry[] = [];
                const availableTimeframes = getAvailableTimeframes(symbol);
                availableTimeframes.forEach(interval => {
                    const intervalPredictions = getCurrentPredictions(interval, showHistoricalPerformance, symbol);
                    allPredictions.push(...intervalPredictions);
                });

                console.log('[ChartContainer] Initial predictions loaded:', {
                    symbol,
                    timeframe: timeframe.binanceInterval,
                    availableTimeframes,
                    totalPredictions: allPredictions.length,
                    nonZero: allPredictions.filter(p => p.value !== 0).length,
                    byTimeframe: availableTimeframes.map(interval => ({
                        interval,
                        count: allPredictions.filter(p => p.timeframeId === interval).length,
                        nonZero: allPredictions.filter(p => p.timeframeId === interval && p.value !== 0).length
                    })),
                    sample: allPredictions.filter(p => p.value !== 0).slice(0, 3)
                });

                setPredictions(allPredictions);

                setViewUpdateTrigger(prev => prev + 1);
            }
        };

        initializeData();

        const unsubscribeUpdates = subscribeToUpdates((data, key) => {
            const [dataSymbol, timeframeId] = key.split('-');
            if (timeframeId === timeframe.id && dataSymbol === symbol && seriesRef.current) {
                // Get the current data
                const currentDataToUse = getCurrentData(timeframe.id, symbol);
                const filteredCurrentData = filterKlinesByDateRange(currentDataToUse);
                const latestData = currentDataToUse[currentDataToUse.length - 1];

                seriesRef.current.setData(
                    filteredCurrentData.map(candle => ({
                        time: candle.time,
                        value: candle.open, // Changed from candle.close to candle.open
                    }))
                );
                setCurrentData(filteredCurrentData);
                setLastPrice(latestData);

                // Update predictions based on whether the current timeframe supports predictions
                const allPredictions: PredictionEntry[] = [];
                const availableTimeframes = getAvailableTimeframes(symbol);
                availableTimeframes.forEach(interval => {
                    const intervalPredictions = getCurrentPredictions(interval, showHistoricalPerformance, symbol);
                    allPredictions.push(...intervalPredictions);
                });
                setPredictions(allPredictions);

                setViewUpdateTrigger(prev => prev + 1);
            }
        });

        const unsubscribePredictions = subscribeToPredictionUpdates((newPredictions, updatedTimeframeId, ticker) => {
            const availableTimeframes = getAvailableTimeframes(symbol);
            if (availableTimeframes.includes(updatedTimeframeId) && ticker === symbol) {
                // Use setTimeout to debounce and let chart data update first
                setTimeout(() => {
                    const allPredictions: PredictionEntry[] = [];
                    availableTimeframes.forEach(interval => {
                        const intervalPredictions = getCurrentPredictions(interval, showHistoricalPerformance, symbol);
                        allPredictions.push(...intervalPredictions);
                    });
                    setPredictions(allPredictions);
                }, 100); // Small delay to let chart data load first
            }
        });


        // Subscribe to view updates from sumtymeAPI
        const unsubscribeViewUpdates = subscribeToViewUpdates(() => {
            setViewUpdateTrigger(prev => prev + 1);
        });

        return () => {
            unsubscribeUpdates();
            unsubscribePredictions();
            unsubscribeViewUpdates();
        };
    }, [timeframe, symbol, showHistoricalPerformance, startDate, endDate, selectedTimeframes]);

    // Update predictions when showHistoricalPerformance changes
    useEffect(() => {
        const allPredictions: PredictionEntry[] = [];
        const availableTimeframes = getAvailableTimeframes(symbol);
        availableTimeframes.forEach(interval => {
            const intervalPredictions = getCurrentPredictions(interval, showHistoricalPerformance, symbol);
            allPredictions.push(...intervalPredictions);
        });
        setPredictions(allPredictions);
    }, [symbol, timeframe.binanceInterval, showHistoricalPerformance]);

    return (
        <div className="relative h-full bg-gray">
            <div className="h-5 md:h-6 border-b border-[#919191] px-1 md:px-2 flex items-center justify-between text-[8px] md:text-[8px]">
                <div className="flex items-center flex-1">
                    {isEditingTimeframe ? (
                        <div className="flex flex-col">
                            <input
                                type="text"
                                value={timeframeInputValue}
                                onChange={handleTimeframeInputChange}
                                onBlur={handleTimeframeInputSubmit}
                                onKeyDown={handleTimeframeInputKeyDown}
                                className="bg-white text-[#e0e0e0] text-[8px] md:text-[10px] px-1 py-0.5 rounded border border-[#919191] focus:border-blue-500 focus:outline-none w-16 md:w-20"
                                autoFocus
                            />
                            {timeframeInputError && (
                                <span className="text-red-600 text-[6px] md:text-[8px] mt-0.5">{timeframeInputError}</span>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={() => setIsEditingTimeframe(true)}
                            className="text-[#e0e0e0] font-medium hover:text-gray-900 transition-colors text-[8px] md:text-[10px]"
                        >
                            {timeframe.label}
                        </button>
                    )}
                </div>
                {lastPrice && (
                    <div className="flex items-center space-x-1 md:space-x-2">
                        <span className="text-[#e0e0e0] hidden sm:inline">O {lastPrice.open.toFixed(2)}</span>
                        <span className="text-[#e0e0e0]">
                            <span className="inline-block w-[2px] h-[2px] bg-green-600 rounded-full align-middle mr-1"></span>
                            positive insight &nbsp;
                            <span className="inline-block w-[2px] h-[2px] bg-red-600 rounded-full align-middle mr-1"></span>
                            negative insight
                        </span>
                    </div>
                )}
            </div>
            <div className="relative h-[calc(100%-20px)] md:h-[calc(100%-24px)]">
                {/* Chart container - managed by lightweight-charts */}
                <div ref={chartContainerRef} className="absolute inset-0" />

                {/* Overlay container - managed by React for PredictionArrows */}
                <div ref={overlayContainerRef} className="absolute inset-0 pointer-events-none">
                    {(() => {
                        // Group arrow positions by datetime to identify overlapping timeframes
                        const positionsByDatetime = new Map<string, ArrowPosition[]>();
                        arrowPositions.forEach(pos => {
                            if (!pos.isChangeEnding) {
                                const key = `${pos.datetime}-${pos.ticker}`;
                                if (!positionsByDatetime.has(key)) {
                                    positionsByDatetime.set(key, []);
                                }
                                positionsByDatetime.get(key)!.push(pos);
                            }
                        });

                        return arrowPositions.map((position) => {
                            if (position.isChangeEnding) {
                                // Change ending label
                                return (
                                    <div
                                        key={`ending-${position.datetime}-${position.ticker}-${position.timeframeId}`}
                                        style={{
                                            position: 'absolute',
                                            left: `${position.x + 1}px`,
                                            top: `${position.y - 20}px`,
                                            transform: 'translate(-50%, -100%)',
                                            color: '#374151',
                                            fontSize: '12px',
                                            fontWeight: 'bold',
                                            zIndex: 3,
                                            pointerEvents: 'none',
                                            fontFamily: 'monospace',
                                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                                            padding: '2px 4px',
                                            borderRadius: '2px',
                                            border: '1px solid #919191',
                                            whiteSpace: 'nowrap'
                                        }}
                                        title={`Change ending period: ${position.datetime} to ${position.endTime}`}
                                    >
                                        change ending ({position.timeframeId})
                                    </div>
                                );
                            } else {
                                // Regular prediction arrow
                                const key = `${position.datetime}-${position.ticker}`;
                                const timeframesAtSameTime = positionsByDatetime.get(key)?.map(p => p.timeframeId) || [];

                                return (
                                    <PredictionArrow
                                        key={`${position.datetime}-${position.ticker}-${position.timeframeId}`}
                                        value={position.value}
                                        position={position}
                                        timeframeId={position.timeframeId}
                                        ticker={position.ticker}
                                        timeframesAtSameTime={timeframesAtSameTime}
                                    />
                                );
                            }
                        });
                    })()}
                </div>
            </div>
        </div>
    );
};

export default ChartContainer;