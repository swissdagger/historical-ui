import React, { useEffect, useState, useCallback, useMemo } from 'react';
import ChartContainer from '../Chart/ChartContainer';
import { getInitialTimeframes, calculateDataLimit, convertIntervalToMinutes } from '../../api/binanceAPI';
import { setSixteenTimesMode, subscribeToPredictionUpdates, loadPredictionsForTicker } from '../../services/predictionService';
import { TimeframeConfig, PredictionEntry } from '../../types';
import { SUPPORTED_PREDICTION_INTERVALS } from '../../api/sumtymeAPI';
import { Info, X, File, ChevronDown, Calendar } from 'lucide-react';
import { getCSVMetadata, loadCSVFile, listLocalCSVFiles, loadLocalCSVFile, getCSVData } from '../../services/csvService';
import { extractTrendIndicators, InitialIndicator, Propagation } from '../../utils/indicatorAnalysis';
import { getDisplayName } from '../../config/fileConfig';
import { MultiSelect } from '../common/MultiSelect';

const parseCustomDateTime = (dateStr: string): Date | null => {
    if (!dateStr || dateStr.trim() === '') return null;

    // Try parsing YYYY-MM-DD or YYYY-DD-MM format as UTC
    const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
    if (match) {
        const [, year, secondNum, thirdNum, hour, minute, second] = match;
        const second_val = parseInt(secondNum);
        const third_val = parseInt(thirdNum);

        // Disambiguate: if second position > 12, it's day (YYYY-DD-MM)
        // if third position > 12, it's day (YYYY-MM-DD)
        // otherwise default to YYYY-MM-DD
        if (second_val > 12) {
            // YYYY-DD-MM format
            return new Date(Date.UTC(parseInt(year), third_val - 1, second_val, parseInt(hour), parseInt(minute), parseInt(second)));
        } else {
            // YYYY-MM-DD format (default)
            return new Date(Date.UTC(parseInt(year), second_val - 1, third_val, parseInt(hour), parseInt(minute), parseInt(second)));
        }
    }

    // Fallback to standard parsing
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
};

const Dashboard: React.FC = () => {
    const [currentFileId, setCurrentFileId] = useState<string>('');
    const [currentFilename, setCurrentFilename] = useState<string>('');
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [showHistoricalPerformance, setShowHistoricalPerformance] = useState(false);
    const [showAllInsights, setShowAllInsights] = useState(false);
    const [loadedFileIds, setLoadedFileIds] = useState<string[]>([]);
    const [availableFiles, setAvailableFiles] = useState<string[]>([]);
    const [showFileDropdown, setShowFileDropdown] = useState(false);
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [selectedTimeframes, setSelectedTimeframes] = useState<string[]>([]);
    const [availableTimeframes, setAvailableTimeframes] = useState<string[]>([]);
    const [selectedPropagationLevel, setSelectedPropagationLevel] = useState<number | null>(null);
    const [showPropagationDropdown, setShowPropagationDropdown] = useState(false);

    const [userSelectedTimeframes, setUserSelectedTimeframes] = useState<TimeframeConfig[]>(
        getInitialTimeframes('DEFAULT', showHistoricalPerformance)
    );
    const [allPredictionsData, setAllPredictionsData] = useState<Record<string, Record<string, PredictionEntry[]>>>({});

    useEffect(() => {
        const updatedTimeframes = userSelectedTimeframes.map(tf => {
            const baseDataLimit = calculateDataLimit(tf.binanceInterval);

            return {
                ...tf,
                dataLimit: showHistoricalPerformance ? baseDataLimit * 4 : baseDataLimit
            };
        });
        setUserSelectedTimeframes(updatedTimeframes);
    }, [showHistoricalPerformance]);

    useEffect(() => {
        const loadFiles = async () => {
            const files = await listLocalCSVFiles();
            setAvailableFiles(files);
            if (files.length > 0 && !currentFileId) {
                const firstFileId = files[0].replace(/\.csv$/i, '');
                const result = await loadLocalCSVFile(files[0]);
                if (result.success && result.fileId) {
                    setCurrentFileId(result.fileId);
                    setCurrentFilename(files[0]);
                    loadPredictionsForTicker(result.fileId);
                    setLoadedFileIds([result.fileId]);

                    const metadata = getCSVMetadata(result.fileId);
                    if (metadata) {
                        setAvailableTimeframes(metadata.availableTimeframes);
                        setSelectedTimeframes(metadata.availableTimeframes);
                    }
                }
            }
        };
        loadFiles();
    }, []);

    useEffect(() => {
        const unsubscribe = subscribeToPredictionUpdates((predictions, timeframeId, fileId) => {
            setAllPredictionsData(prev => ({
                ...prev,
                [fileId]: {
                    ...(prev[fileId] || {}),
                    [timeframeId]: predictions
                }
            }));
        });

        return unsubscribe;
    }, []);

    const getHighestFrequencyTimeframe = (): TimeframeConfig => {
        if (userSelectedTimeframes.length === 0) {
            return {
                id: '1m',
                label: '1 Minute',
                binanceInterval: '1m',
                wsEndpoint: 'csv@kline_1m',
                color: '#919191',
                dataLimit: calculateDataLimit('1m'),
            };
        }

        return userSelectedTimeframes.reduce((highest, current) => {
            const currentMinutes = convertIntervalToMinutes(current.binanceInterval);
            const highestMinutes = convertIntervalToMinutes(highest.binanceInterval);
            return currentMinutes < highestMinutes ? current : highest;
        });
    };

    const handleTimeframeUpdate = (updatedTimeframe: TimeframeConfig) => {
        setUserSelectedTimeframes(prevTimeframes =>
            prevTimeframes.map(tf =>
                tf.id === updatedTimeframe.id ? updatedTimeframe : tf
            )
        );
    };

    const handleFileSelect = async (filename: string) => {
        const fileId = filename.replace(/\.csv$/i, '');
        const result = await loadLocalCSVFile(filename);
        if (result.success && result.fileId) {
            setCurrentFileId(result.fileId);
            setCurrentFilename(filename);
            loadPredictionsForTicker(result.fileId);
            if (!loadedFileIds.includes(result.fileId)) {
                setLoadedFileIds(prev => [...prev, result.fileId]);
            }

            const metadata = getCSVMetadata(result.fileId);
            if (metadata) {
                setAvailableTimeframes(metadata.availableTimeframes);
                setSelectedTimeframes(metadata.availableTimeframes);
                setStartDate('');
                setEndDate('');
            }
        }
        setShowFileDropdown(false);
    };

    const currentMetadata = currentFileId ? getCSVMetadata(currentFileId) : null;

    const { initialIndicators, propagations, maxPropagationLevel } = useMemo(() => {
        if (!currentFileId || !allPredictionsData[currentFileId]) {
            return { initialIndicators: [], propagations: [], maxPropagationLevel: 0 };
        }

        if (selectedTimeframes.length === 0) {
            return { initialIndicators: [], propagations: [], maxPropagationLevel: 0 };
        }

        const filteredPredictions = { ...allPredictionsData[currentFileId] };
        const csvData = getCSVData(currentFileId);

        const result = extractTrendIndicators(filteredPredictions, selectedTimeframes, csvData);

        let filteredInitialIndicators = result.initialIndicators;
        let filteredPropagations = result.propagations;

        if (startDate || endDate) {
            const start = startDate ? (parseCustomDateTime(startDate) || new Date(0)) : new Date(0);
            const end = endDate ? (parseCustomDateTime(endDate) || new Date(8640000000000000)) : new Date(8640000000000000);

            filteredInitialIndicators = filteredInitialIndicators.filter(ind => {
                const indDate = new Date(ind.datetime.replace(' ', 'T') + 'Z');
                return indDate >= start && indDate <= end;
            });

            filteredPropagations = filteredPropagations.filter(prop => {
                const propDate = new Date(prop.datetime.replace(' ', 'T') + 'Z');
                return propDate >= start && propDate <= end;
            });
        }

        const maxLevel = filteredPropagations.reduce((max, prop) =>
            Math.max(max, prop.propagation_level), 0
        );

        return { initialIndicators: filteredInitialIndicators, propagations: filteredPropagations, maxPropagationLevel: maxLevel };
    }, [currentFileId, allPredictionsData, startDate, endDate, selectedTimeframes, availableTimeframes]);

    return (
        <div style={{ backgroundColor: '#242424' }}>
            <div className="flex items-center justify-between border-b px-2 py-0.5 md:px-4 md:py-1 sticky top-0 z-20" style={{ backgroundColor: '#242424', borderColor: '#919191' }}>
                <div className="flex items-center space-x-2">
                    <div className="relative">
                        <button
                            onClick={() => setShowFileDropdown(prev => !prev)}
                            className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium text-white transition-colors"
                            style={{ backgroundColor: '#242424', borderWidth: '1px', borderColor: '#919191' }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#3a3a3a'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#242424'}
                        >
                            <File size={12} />
                            <span>{currentFilename ? getDisplayName(currentFilename) : 'Select File'}</span>
                            <ChevronDown size={12} />
                        </button>
                        {showFileDropdown && (
                            <div className="absolute top-full left-0 mt-1 rounded shadow-lg z-50 min-w-[200px]" style={{ backgroundColor: '#2a2a2a', borderWidth: '1px', borderColor: '#919191' }}>
                                {availableFiles.length > 0 ? (
                                    availableFiles.map((filename) => (
                                        <button
                                            key={filename}
                                            onClick={() => handleFileSelect(filename)}
                                            className="w-full text-left px-3 py-2 text-xs transition-colors"
                                            style={{ color: '#e0e0e0' }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#3a3a3a'}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            {getDisplayName(filename)}
                                        </button>
                                    ))
                                ) : (
                                    <div className="px-3 py-2 text-xs text-center" style={{ color: '#919191' }}>
                                        No files available
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => setShowInfoModal(true)}
                        className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium transition-colors"
                        style={{ backgroundColor: '#2a2a2a', color: '#e0e0e0', borderWidth: '1px', borderColor: '#919191' }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3a3a3a'; e.currentTarget.style.color = '#ffffff'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#2a2a2a'; e.currentTarget.style.color = '#e0e0e0'; }}
                    >
                        <Info size={12} />
                        <span>Info</span>
                    </button>

                    <button
                        onClick={() => setShowAllInsights(prev => !prev)}
                        className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium transition-colors"
                        style={{
                            backgroundColor: showAllInsights ? '#919191' : '#2a2a2a',
                            color: showAllInsights ? '#242424' : '#e0e0e0',
                            borderWidth: '1px',
                            borderColor: '#919191'
                        }}
                        onMouseEnter={(e) => {
                            if (!showAllInsights) {
                                e.currentTarget.style.backgroundColor = '#3a3a3a';
                                e.currentTarget.style.color = '#ffffff';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!showAllInsights) {
                                e.currentTarget.style.backgroundColor = '#2a2a2a';
                                e.currentTarget.style.color = '#e0e0e0';
                            }
                        }}
                    >
                        <span>All Insights</span>
                    </button>

                    <div className="relative">
                        <button
                            onClick={() => setShowPropagationDropdown(prev => !prev)}
                            className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium transition-colors"
                            style={{
                                backgroundColor: selectedPropagationLevel !== null ? '#919191' : '#2a2a2a',
                                color: selectedPropagationLevel !== null ? '#242424' : '#e0e0e0',
                                borderWidth: '1px',
                                borderColor: '#919191'
                            }}
                            onMouseEnter={(e) => {
                                if (selectedPropagationLevel === null) {
                                    e.currentTarget.style.backgroundColor = '#3a3a3a';
                                    e.currentTarget.style.color = '#ffffff';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (selectedPropagationLevel === null) {
                                    e.currentTarget.style.backgroundColor = '#2a2a2a';
                                    e.currentTarget.style.color = '#e0e0e0';
                                }
                            }}
                        >
                            <span>{selectedPropagationLevel !== null ? `Level ${selectedPropagationLevel}+` : 'All Levels'}</span>
                            <ChevronDown size={12} />
                        </button>
                        {showPropagationDropdown && (
                            <div className="absolute top-full left-0 mt-1 rounded shadow-lg z-50 min-w-[120px]" style={{ backgroundColor: '#2a2a2a', borderWidth: '1px', borderColor: '#919191' }}>
                                <button
                                    onClick={() => {
                                        setSelectedPropagationLevel(null);
                                        setShowPropagationDropdown(false);
                                    }}
                                    className="w-full text-left px-3 py-2 text-xs transition-colors"
                                    style={{
                                        backgroundColor: selectedPropagationLevel === null ? '#919191' : 'transparent',
                                        color: selectedPropagationLevel === null ? '#242424' : '#e0e0e0'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (selectedPropagationLevel !== null) e.currentTarget.style.backgroundColor = '#3a3a3a';
                                    }}
                                    onMouseLeave={(e) => {
                                        if (selectedPropagationLevel !== null) e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    All Levels
                                </button>
                                {Array.from({ length: maxPropagationLevel }, (_, i) => i + 1).map((level) => (
                                    <button
                                        key={level}
                                        onClick={() => {
                                            setSelectedPropagationLevel(level);
                                            setShowPropagationDropdown(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs transition-colors"
                                        style={{
                                            backgroundColor: selectedPropagationLevel === level ? '#919191' : 'transparent',
                                            color: selectedPropagationLevel === level ? '#242424' : '#e0e0e0'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (selectedPropagationLevel !== level) e.currentTarget.style.backgroundColor = '#3a3a3a';
                                        }}
                                        onMouseLeave={(e) => {
                                            if (selectedPropagationLevel !== level) e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                    >
                                        Level {level}+
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center space-x-4">
                    {currentMetadata && (
                        <div className="flex items-center space-x-2 text-xs">
                            <span style={{ color: '#e0e0e0' }}>{currentMetadata.rowCount.toLocaleString()} rows</span>
                        </div>
                    )}
                </div>
            </div>

            {showInfoModal && (
                <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}>
                    <div className="rounded-lg max-w-5xl w-full max-h-[80vh] overflow-y-auto" style={{ backgroundColor: '#2a2a2a', borderWidth: '1px', borderColor: '#919191' }}>
                        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#919191' }}>
                            <h2 className="text-lg font-semibold" style={{ color: '#e0e0e0' }}>CSV Visualization Tool</h2>
                            <button
                                onClick={() => setShowInfoModal(false)}
                                className="transition-colors"
                                style={{ color: '#919191' }}
                                onMouseEnter={(e) => e.currentTarget.style.color = '#e0e0e0'}
                                onMouseLeave={(e) => e.currentTarget.style.color = '#919191'}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 leading-relaxed" style={{ color: '#c0c0c0' }}>
                            <p className="font-medium" style={{ color: '#e0e0e0' }}>
                                This tool visualises historical data from CSV files with forecasts from sumtyme.ai's Causal Intelligence Layer.
                            </p>

                            <div className="pt-4 border-t" style={{ borderColor: '#919191' }}>
                                <h3 className="font-medium mb-2" style={{ color: '#e0e0e0' }}>How to Use</h3>
                                <ol className="list-decimal list-inside space-y-1 text-sm">
                                    <li>Select a file from the dropdown to load data</li>
                                    <li>Use date range and timeframe filters to focus on specific periods</li>
                                    <li>Turn on "All Insights" to see all prediction points instead of just propagations</li>
                                    <li>View Initial Indicators and Propagations tables below the chart</li>
                                </ol>
                            </div>

                            <div className="pt-4 border-t" style={{ borderColor: '#919191' }}>
                                <h3 className="font-medium mb-2" style={{ color: '#e0e0e0' }}>Visualisation</h3>
                                <p className="text-sm">
                                    The chart displays the open price as a line. Green dots represent positive causal chain insights,
                                    whilst red dots represent negative causal chain insights. Forecasts are plotted at the open price of
                                    the corresponding candle.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="pb-8">
                {currentFileId ? (
                    <div style={{ backgroundColor: '#242424' }}>
                        <div style={{ height: '100vh', backgroundColor: '#242424' }}>
                            <ChartContainer
                                timeframe={getHighestFrequencyTimeframe()}
                                height={window.innerHeight}
                                symbol={currentFileId}
                                fixLeftEdge={true}
                                onTimeframeUpdate={handleTimeframeUpdate}
                                showHistoricalPerformance={showHistoricalPerformance}
                                allPredictions={allPredictionsData}
                                showAllInsights={showAllInsights}
                                startDate={startDate}
                                endDate={endDate}
                                selectedTimeframes={selectedTimeframes}
                                propagations={propagations}
                                initialIndicators={initialIndicators}
                                selectedPropagationLevel={selectedPropagationLevel}
                            />
                        </div>
                        <div className="border-t p-4" style={{ backgroundColor: '#242424', borderColor: '#919191' }}>
                            <div className="mb-4 flex flex-wrap gap-4">
                                <div className="flex items-center space-x-2">
                                    <Calendar size={14} style={{ color: '#919191' }} />
                                    <label className="text-xs font-medium" style={{ color: '#e0e0e0' }}>Datetime Range:</label>
                                    <input
                                        type="text"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="px-2 py-1 text-xs border rounded focus:outline-none font-mono"
                                        style={{ backgroundColor: '#2a2a2a', color: '#e0e0e0', borderColor: '#919191' }}
                                        placeholder="YYYY-MM-DD HH:MM:SS"
                                    />
                                    <span style={{ color: '#919191' }}>to</span>
                                    <input
                                        type="text"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        className="px-2 py-1 text-xs border rounded focus:outline-none font-mono"
                                        style={{ backgroundColor: '#2a2a2a', color: '#e0e0e0', borderColor: '#919191' }}
                                        placeholder="YYYY-MM-DD HH:MM:SS"
                                    />
                                </div>
                                <div className="flex items-center space-x-2">
                                    <label className="text-xs font-medium" style={{ color: '#e0e0e0' }}>Timeframes:</label>
                                    <MultiSelect
                                        options={availableTimeframes}
                                        value={selectedTimeframes}
                                        onChange={setSelectedTimeframes}
                                        placeholder="Select timeframes"
                                    />
                                </div>
                            </div>

                            <div className="mb-6">
                                <h3 className="font-medium mb-3 text-sm" style={{ color: '#e0e0e0' }}>Initial Indicators</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs border-collapse">
                                        <thead>
                                            <tr style={{ backgroundColor: '#2a2a2a' }}>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Datetime</th>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Value</th>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Timeframe</th>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>End Datetime</th>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Open Price</th>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Directional Change %</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {initialIndicators.length > 0 ? initialIndicators.map((ind, idx) => (
                                                <tr key={idx} style={{ cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                    <td className="border px-2 py-1 font-mono" style={{ borderColor: '#919191', color: '#e0e0e0' }}>{ind.datetime}</td>
                                                    <td className="border px-2 py-1" style={{ borderColor: '#919191' }}>
                                                        <span className={ind.trend_type > 0 ? 'text-green-400' : 'text-red-400'}>
                                                            {ind.trend_type > 0 ? '↑' : '↓'} {ind.trend_type}
                                                        </span>
                                                    </td>
                                                    <td className="border px-2 py-1" style={{ borderColor: '#919191', color: '#e0e0e0' }}>{ind.timeframe}</td>
                                                    <td className="border px-2 py-1 font-mono" style={{ borderColor: '#919191', color: '#e0e0e0' }}>{ind.end_datetime || 'N/A'}</td>
                                                    <td className="border px-2 py-1" style={{ borderColor: '#919191', color: '#e0e0e0' }}>{ind.open_price.toFixed(2)}</td>
                                                    <td className="border px-2 py-1" style={{ borderColor: '#919191', color: '#e0e0e0' }}>{ind.directional_change_percent.toFixed(2)}%</td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan={6} className="border px-2 py-3 text-center" style={{ borderColor: '#919191', color: '#919191' }}>
                                                        No initial indicators found
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <h3 className="font-medium mb-3 text-sm" style={{ color: '#e0e0e0' }}>Propagations</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs border-collapse">
                                        <thead>
                                            <tr style={{ backgroundColor: '#2a2a2a' }}>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Prop ID</th>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Level</th>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Datetime</th>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Value</th>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Higher Freq</th>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Lower Freq</th>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Open Price</th>
                                                <th className="border px-2 py-1 text-left font-medium" style={{ borderColor: '#919191', color: '#e0e0e0' }}>Directional Change %</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {propagations.length > 0 ? propagations.map((prop, idx) => (
                                                <tr key={idx} style={{ cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                    <td className="border px-2 py-1" style={{ borderColor: '#919191', color: '#e0e0e0' }}>{prop.propagation_id}</td>
                                                    <td className="border px-2 py-1" style={{ borderColor: '#919191', color: '#e0e0e0' }}>{prop.propagation_level}</td>
                                                    <td className="border px-2 py-1 font-mono" style={{ borderColor: '#919191', color: '#e0e0e0' }}>{prop.datetime}</td>
                                                    <td className="border px-2 py-1" style={{ borderColor: '#919191' }}>
                                                        <span className={prop.trend_type > 0 ? 'text-green-400' : 'text-red-400'}>
                                                            {prop.trend_type > 0 ? '↑' : '↓'} {prop.trend_type}
                                                        </span>
                                                    </td>
                                                    <td className="border px-2 py-1" style={{ borderColor: '#919191', color: '#e0e0e0' }}>{prop.higher_freq}</td>
                                                    <td className="border px-2 py-1" style={{ borderColor: '#919191', color: '#e0e0e0' }}>{prop.lower_freq}</td>
                                                    <td className="border px-2 py-1" style={{ borderColor: '#919191', color: '#e0e0e0' }}>{prop.open_price.toFixed(2)}</td>
                                                    <td className="border px-2 py-1" style={{ borderColor: '#919191' }}>
                                                        <span className={prop.directional_change_percent >= 0 ? 'text-green-400' : 'text-red-400'}>
                                                            {prop.directional_change_percent.toFixed(2)}%
                                                        </span>
                                                    </td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan={8} className="border px-2 py-3 text-center" style={{ borderColor: '#919191', color: '#919191' }}>
                                                        No propagations found
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                            <File className="mx-auto mb-4" style={{ color: '#919191' }} size={64} />
                            <h2 className="text-xl mb-2" style={{ color: '#e0e0e0' }}>No CSV File Loaded</h2>
                            <p className="mb-4" style={{ color: '#919191' }}>Select a file from the dropdown to begin</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
