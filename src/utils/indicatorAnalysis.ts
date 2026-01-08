import { PredictionEntry, CandlestickData } from '../types';

export interface InitialIndicator {
    datetime: string;
    trend_type: number;
    timeframe: string;
    end_datetime: string | null;
    open_price: number;
    directional_change_percent: number;
}

export interface Propagation {
    propagation_id: string;
    propagation_level: number;
    datetime: string;
    trend_type: number;
    higher_freq: string;
    lower_freq: string;
    open_price: number;
    directional_change_percent: number;
}

function timeframeToSeconds(timeframe: string): number {
    const match = timeframe.match(/^(\d+)(s|m|h|d|w|mo)$/);
    if (!match) return 0;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case 's': return value;
        case 'm': return value * 60;
        case 'h': return value * 3600;
        case 'd': return value * 86400;
        case 'w': return value * 604800;
        case 'mo': return value * 2592000;
        default: return 0;
    }
}

function getOpenPriceAtDatetime(csvData: CandlestickData[], datetime: string, priceMap?: Map<number, number>): number {
    const targetTime = new Date(datetime.replace(' ', 'T') + 'Z').getTime() / 1000;

    if (priceMap) {
        return priceMap.get(targetTime) || 0;
    }

    const candle = csvData.find(c => c.time === targetTime);
    return candle?.open || 0;
}

export function extractTrendIndicators(
    allPredictions: Record<string, PredictionEntry[]>,
    selectedTimeframes: string[] = [],
    csvData: CandlestickData[] = []
): { initialIndicators: InitialIndicator[], propagations: Propagation[] } {
    const allTimeframes = Object.keys(allPredictions);

    const selectedTimeframesSet = new Set(selectedTimeframes);
    const timeframesToUse = selectedTimeframes.length > 0
        ? allTimeframes.filter(tf => selectedTimeframesSet.has(tf))
        : allTimeframes;

    const sortedTimeframes = timeframesToUse.sort((a, b) => timeframeToSeconds(a) - timeframeToSeconds(b));

    if (sortedTimeframes.length === 0) {
        return { initialIndicators: [], propagations: [] };
    }

    const timeToPriceMap = new Map<number, number>();
    csvData.forEach(candle => {
        timeToPriceMap.set(candle.time, candle.open);
    });

    const timeframeIndexMap = new Map<string, number>();
    sortedTimeframes.forEach((tf, index) => {
        timeframeIndexMap.set(tf, index);
    });

    const highestFreqTimeframe = sortedTimeframes[0];
    const highestFreqPredictions = allPredictions[highestFreqTimeframe] || [];

    const sortedPredictions = [...highestFreqPredictions].sort((a, b) =>
        new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
    );

    const initialIndicators: InitialIndicator[] = [];
    let lastSignal: number | null = null;

    for (const pred of sortedPredictions) {
        if (pred.value !== 0) {
            if (lastSignal === null || pred.value !== lastSignal) {
                const openPrice = getOpenPriceAtDatetime(csvData, pred.datetime, timeToPriceMap);
                initialIndicators.push({
                    datetime: pred.datetime,
                    trend_type: pred.value,
                    timeframe: highestFreqTimeframe,
                    end_datetime: null,
                    open_price: openPrice,
                    directional_change_percent: 0
                });
                lastSignal = pred.value;
            }
        }
    }

    // Assign end_datetime based on the next opposing signal
    for (let i = 0; i < initialIndicators.length; i++) {
        const startDatetime = new Date(initialIndicators[i].datetime);
        const trendType = initialIndicators[i].trend_type;
        const opposingSignalValue = -trendType;

        const laterSignal = sortedPredictions.find(pred =>
            new Date(pred.datetime) > startDatetime &&
            pred.value === opposingSignalValue
        );

        if (laterSignal) {
            initialIndicators[i].end_datetime = laterSignal.datetime;
        } else {
            initialIndicators[i].end_datetime = sortedPredictions[sortedPredictions.length - 1]?.datetime || null;
        }
    }

    // Step 2: Identify cross-timeframe propagations with dynamic chain tracking
    const propagations: Propagation[] = [];
    let propagationCounter = 0;

    console.log('[indicatorAnalysis] Starting propagation detection. Initial indicators:', initialIndicators.length);

    // Track all signals across all timeframes with their metadata
    interface SignalInfo {
        datetime: string;
        datetimeMs: number;
        timeframe: string;
        timeframeIndex: number;
        trendType: number;
        openPrice: number;
        propagationLevel: number;
        propagationId: string;
        chainInitialPrice: number;
    }

    const allSignals: SignalInfo[] = [];

    // Add initial indicators as level 0
    for (const initialInd of initialIndicators) {
        propagationCounter++;
        allSignals.push({
            datetime: initialInd.datetime,
            datetimeMs: new Date(initialInd.datetime).getTime(),
            timeframe: initialInd.timeframe,
            timeframeIndex: timeframeIndexMap.get(initialInd.timeframe) ?? 0,
            trendType: initialInd.trend_type,
            openPrice: initialInd.open_price,
            propagationLevel: 0,
            propagationId: `Prop_${propagationCounter}`,
            chainInitialPrice: initialInd.open_price
        });
    }

    // Process each timeframe from high to low frequency
    for (let i = 1; i < sortedTimeframes.length; i++) {
        const currentTimeframe = sortedTimeframes[i];
        const currentPredictions = allPredictions[currentTimeframe] || [];

        // For each signal on this timeframe
        for (const pred of currentPredictions) {
            if (pred.value === 0) continue;

            const predDatetimeMs = new Date(pred.datetime).getTime();

            // Check if this signal was already preceded by the same signal type on this timeframe
            const previousSameTypeSignal = currentPredictions.find(p => {
                const pTime = new Date(p.datetime).getTime();
                return pTime < predDatetimeMs && p.value === pred.value && p.value !== 0;
            });

            if (previousSameTypeSignal) {
                continue; // Skip if already had this signal type
            }

            // Find all potential parent signals from higher frequency timeframes
            const potentialParents = allSignals.filter(signal =>
                signal.timeframeIndex < i && // Higher frequency
                signal.trendType === pred.value && // Same direction
                signal.datetimeMs <= predDatetimeMs // Parent came before or at the same time
            );

            if (potentialParents.length === 0) continue;

            // Sort by most recent and highest propagation level
            potentialParents.sort((a, b) => {
                if (b.propagationLevel !== a.propagationLevel) {
                    return b.propagationLevel - a.propagationLevel;
                }
                return b.datetimeMs - a.datetimeMs;
            });

            // Try each potential parent until we find a valid one
            let validParent: SignalInfo | null = null;

            for (const parent of potentialParents) {
                // Check if the parent's timeframe has an opposing signal between parent time and current signal time
                const parentTimeframePredictions = allPredictions[parent.timeframe] || [];
                const opposingSignalValue = -parent.trendType;

                const hasOpposingSignal = parentTimeframePredictions.some(p => {
                    const pTime = new Date(p.datetime).getTime();
                    return pTime > parent.datetimeMs &&
                           pTime <= predDatetimeMs &&
                           p.value === opposingSignalValue;
                });

                if (!hasOpposingSignal) {
                    validParent = parent;
                    break;
                }
            }

            if (validParent) {
                const propOpenPrice = getOpenPriceAtDatetime(csvData, pred.datetime, timeToPriceMap);
                const newPropagationLevel = validParent.propagationLevel + 1;
                const directionalChange = validParent.chainInitialPrice !== 0
                    ? ((propOpenPrice - validParent.chainInitialPrice) / validParent.chainInitialPrice) * 100
                    : 0;

                const propagation: Propagation = {
                    propagation_id: validParent.propagationId,
                    propagation_level: newPropagationLevel,
                    datetime: pred.datetime,
                    trend_type: pred.value,
                    higher_freq: validParent.timeframe,
                    lower_freq: currentTimeframe,
                    open_price: propOpenPrice,
                    directional_change_percent: directionalChange
                };

                console.log('[indicatorAnalysis] Detected propagation:', {
                    level: newPropagationLevel,
                    from: validParent.timeframe,
                    to: currentTimeframe,
                    datetime: pred.datetime,
                    type: pred.value > 0 ? 'up' : 'down',
                    parentLevel: validParent.propagationLevel
                });

                propagations.push(propagation);

                // Add this as a new signal that can be a parent for even lower frequencies
                allSignals.push({
                    datetime: pred.datetime,
                    datetimeMs: predDatetimeMs,
                    timeframe: currentTimeframe,
                    timeframeIndex: i,
                    trendType: pred.value,
                    openPrice: propOpenPrice,
                    propagationLevel: newPropagationLevel,
                    propagationId: validParent.propagationId,
                    chainInitialPrice: validParent.chainInitialPrice
                });
            }
        }
    }

    console.log('[indicatorAnalysis] Total propagations detected:', propagations.length);
    if (propagations.length > 0) {
        console.log('[indicatorAnalysis] Sample propagations:', propagations.slice(0, 5));
    }

    return { initialIndicators, propagations };
}
