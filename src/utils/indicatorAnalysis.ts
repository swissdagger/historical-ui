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

    // Step 2: Identify cross-timeframe propagations
    const propagations: Propagation[] = [];
    let propagationCounter = 0;

    for (const initialInd of initialIndicators) {
        const currentDatetime = new Date(initialInd.datetime);
        const currentType = initialInd.trend_type;
        const currentTimeframeIndex = timeframeIndexMap.get(initialInd.timeframe) ?? 0;
        const endDatetime = initialInd.end_datetime ? new Date(initialInd.end_datetime) : null;
        const initialOpenPrice = initialInd.open_price;

        if (!endDatetime) continue;

        let currentChainDatetime = currentDatetime;
        let currentChainTimeframeIndex = currentTimeframeIndex;
        let propagationLevel = 0;

        propagationCounter++;
        const currentPropagationId = `Prop_${propagationCounter}`;

        for (let j = currentChainTimeframeIndex + 1; j < sortedTimeframes.length; j++) {
            const nextLowerTimeframe = sortedTimeframes[j];
            const nextLowerPredictions = allPredictions[nextLowerTimeframe] || [];

            const currentChainTime = currentChainDatetime.getTime();
            const endTime = endDatetime.getTime();

            const laterSignals = nextLowerPredictions.filter(pred => {
                const predTime = new Date(pred.datetime).getTime();
                return predTime >= currentChainTime &&
                       predTime <= endTime &&
                       pred.value === currentType;
            }).sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

            if (laterSignals.length > 0) {
                const nextSignal = laterSignals[0];
                const nextSignalDatetime = new Date(nextSignal.datetime);

                const previousPredictions = nextLowerPredictions
                    .filter(pred => new Date(pred.datetime).getTime() < currentChainTime && pred.value !== 0)
                    .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

                if (previousPredictions.length > 0 && previousPredictions[0].value === currentType) {
                    break;
                }

                const initialFreqPredictions = allPredictions[sortedTimeframes[currentTimeframeIndex]] || [];
                const opposingSignalValue = -currentType;
                const nextSignalTime = nextSignalDatetime.getTime();

                const opposingSignalFound = initialFreqPredictions.some(pred => {
                    const predTime = new Date(pred.datetime).getTime();
                    return predTime > currentChainTime &&
                           predTime <= nextSignalTime &&
                           pred.value === opposingSignalValue;
                });

                if (!opposingSignalFound) {
                    propagationLevel++;
                    const propOpenPrice = getOpenPriceAtDatetime(csvData, nextSignal.datetime, timeToPriceMap);
                    const directionalChange = initialOpenPrice !== 0
                        ? ((propOpenPrice - initialOpenPrice) / initialOpenPrice) * 100
                        : 0;

                    propagations.push({
                        propagation_id: currentPropagationId,
                        propagation_level: propagationLevel,
                        datetime: nextSignal.datetime,
                        trend_type: currentType,
                        higher_freq: sortedTimeframes[currentChainTimeframeIndex],
                        lower_freq: nextLowerTimeframe,
                        open_price: propOpenPrice,
                        directional_change_percent: directionalChange
                    });

                    currentChainDatetime = nextSignalDatetime;
                    currentChainTimeframeIndex = j;
                } else {
                    break;
                }
            } else {
                break;
            }
        }
    }

    return { initialIndicators, propagations };
}
