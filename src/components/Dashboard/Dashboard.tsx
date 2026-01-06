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
        <div className="bg-[#242424]">
            <div className="flex items-center justify-between bg-[#242424] border-b border-[#3a3a3a] px-2 py-0.5 md:px-4 md:py-1 sticky top-0 z-20">
                <div className="flex items-center space-x-2">
                    <div className="relative">
                        <button
                            onClick={() => setShowFileDropdown(prev => !prev)}
                            className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium bg-[#3a3a3a] text-white hover:bg-[#4a4a4a] transition-colors"
                        >
                            <File size={12} />
                            <span>{currentFilename ? getDisplayName(currentFilename) : 'Select File'}</span>
                            <ChevronDown size={12} />
                        </button>
                        {showFileDropdown && (
                            <div className="absolute top-full left-0 mt-1 bg-[#242424] border border-[#3a3a3a] rounded shadow-lg z-50 min-w-[200px]">
                                {availableFiles.length > 0 ? (
                                    availableFiles.map((filename) => (
                                        <button
                                            key={filename}
                                            onClick={() => handleFileSelect(filename)}
                                            className="w-full text-left px-3 py-2 text-xs text-white hover:bg-[#3a3a3a] transition-colors"
                                        >
                                            {getDisplayName(filename)}
                                        </button>
                                    ))
                                ) : (
                                    <div className="px-3 py-2 text-xs text-[#707070]">
                                        No files available
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => setShowInfoModal(true)}
                        className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium bg-[#3a3a3a] text-white hover:bg-[#4a4a4a] transition-colors"
                    >
                        <Info size={12} />
                        <span>Info</span>
                    </button>

                    <button
                        onClick={() => setShowAllInsights(prev => !prev)}
                        className={`flex items-center space-x-1 px-2 py-1 rounded text-xs tezt-white font-medium transition-colors ${showAllInsights
                                ? 'bg-green-600 text-white hover:bg-green-700'
                                : 'bg-[#3a3a3a] text-white hover:bg-[#4a4a4a]'
                            }`}
                    >
                        <span>All Insights</span>
                    </button>

                    <div className="relative">
                        <button
                            onClick={() => setShowPropagationDropdown(prev => !prev)}
                            className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium transition-colors ${selectedPropagationLevel !== null
                                    ? 'bg-gray-600 text-white hover:bg-gray-700'
                                    : 'bg-[#3a3a3a] text-[#919191] hover:bg-[#4a4a4a]'
                                }`}
                        >
                            <span>{selectedPropagationLevel !== null ? `Level ${selectedPropagationLevel}+` : 'All Levels'}</span>
                            <ChevronDown size={12} />
                        </button>
                        {showPropagationDropdown && (
                            <div className="absolute top-full left-0 mt-1 bg-[#242424] border border-[#3a3a3a] rounded shadow-lg z-50 min-w-[120px]">
                                <button
                                    onClick={() => {
                                        setSelectedPropagationLevel(null);
                                        setShowPropagationDropdown(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${selectedPropagationLevel === null
                                            ? 'bg-orange-600 text-white'
                                            : 'text-[#919191] hover:bg-[#3a3a3a]'
                                        }`}
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
                                        className={`w-full text-left px-3 py-2 text-xs transition-colors ${selectedPropagationLevel === level
                                                ? 'bg-orange-600 text-white'
                                                : 'text-[#919191] hover:bg-[#3a3a3a]'
                                            }`}
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
                            <span className="text-[#919191]">{currentMetadata.rowCount.toLocaleString()} rows</span>
                        </div>
                    )}
                </div>
            </div>

            {showInfoModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-[#242424] border border-[#3a3a3a] rounded-lg max-w-5xl w-full max-h-[80vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-4 border-b border-[#3a3a3a]">
                            <h2 className="text-[#919191] text-lg font-semibold">CSV Visualization Tool</h2>
                            <button
                                onClick={() => setShowInfoModal(false)}
                                className="text-[#919191] hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 text-[#919191] leading-relaxed">
                            <p className="text-white font-medium">
                                This tool visualises historical data from CSV files with forecasts from sumtyme.ai's Causal Intelligence Layer.
                            </p>

                            <div className="pt-4 border-t border-[#3a3a3a]">
                                <h3 className="text-white font-medium mb-2">How to Use</h3>
                                <ol className="list-decimal list-inside space-y-1 text-sm">
                                    <li>Select a file from the dropdown to load data</li>
                                    <li>Use date range and timeframe filters to focus on specific periods</li>
                                    <li>Turn on "All Insights" to see all prediction points instead of just propagations</li>
                                    <li>View Initial Indicators and Propagations tables below the chart</li>
                                </ol>
                            </div>

                            <div className="pt-4 border-t border-[#3a3a3a]">
                                <h3 className="text-white font-medium mb-2">Visualisation</h3>
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
                    <div className="bg-[#242424]">
                        <div className="bg-[#242424]" style={{ height: '100vh' }}>
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
                        <div className="bg-[#242424] border-t border-[#3a3a3a] p-4">
                            <div className="mb-4 flex flex-wrap gap-4">
                                <div className="flex items-center space-x-2">
                                    <Calendar size={14} className="text-[#919191]" />
                                    <label className="text-white text-xs font-medium">Datetime Range:</label>
                                    <input
                                        type="text"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="px-2 py-1 text-xs bg-[#3a3a3a] text-[#919191] border border-[#4a4a4a] rounded focus:outline-none focus:border-[#5a5a5a] font-mono"
                                        placeholder="YYYY-MM-DD HH:MM:SS"
                                    />
                                    <span className="text-white text-xs">to</span>
                                    <input
                                        type="text"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        className="px-2 py-1 text-xs bg-[#3a3a3a] text-[#919191] border border-[#4a4a4a] rounded focus:outline-none focus:border-[#5a5a5a] font-mono"
                                        placeholder="YYYY-MM-DD HH:MM:SS"
                                    />
                                </div>
                                <div className="flex items-center space-x-2">
                                    <label className="text-white text-xs font-medium">Timeframes:</label>
                                    <MultiSelect
                                        options={availableTimeframes}
                                        value={selectedTimeframes}
                                        onChange={setSelectedTimeframes}
                                        placeholder="Select timeframes"
                                    />
                                </div>
                            </div>

                            <div className="mb-6">
                                <h3 className="text-white font-medium mb-3 text-sm">Initial Indicators</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-[#3a3a3a]">
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Datetime</th>
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Value</th>
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Timeframe</th>
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">End Datetime</th>
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Open Price</th>
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Directional Change %</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {initialIndicators.length > 0 ? initialIndicators.map((ind, idx) => (
                                                <tr key={idx} className="hover:bg-[#2a2a2a]">
                                                    <td className="border border-[#4a4a4a] px-2 py-1 font-mono text-white">{ind.datetime}</td>
                                                    <td className="border border-[#4a4a4a] px-2 py-1">
                                                        <span className={ind.trend_type > 0 ? 'text-green-600' : 'text-red-600'}>
                                                            {ind.trend_type > 0 ? '↑' : '↓'} {ind.trend_type}
                                                        </span>
                                                    </td>
                                                    <td className="border border-[#4a4a4a] px-2 py-1 text-white">{ind.timeframe}</td>
                                                    <td className="border border-[#4a4a4a] px-2 py-1 font-mono text-white">{ind.end_datetime || 'N/A'}</td>
                                                    <td className="border border-[#4a4a4a] px-2 py-1 text-white">{ind.open_price.toFixed(2)}</td>
                                                    <td className="border border-[#4a4a4a] px-2 py-1 text-white">{ind.directional_change_percent.toFixed(2)}%</td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan={6} className="border border-[#4a4a4a] px-2 py-3 text-center text-[#707070]">
                                                        No initial indicators found
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-white font-medium mb-3 text-sm">Propagations</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-[#3a3a3a]">
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Prop ID</th>
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Level</th>
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Datetime</th>
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Value</th>
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Higher Freq</th>
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Lower Freq</th>
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Open Price</th>
                                                <th className="border border-[#4a4a4a] px-2 py-1 text-left text-white font-medium">Directional Change %</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {propagations.length > 0 ? propagations.map((prop, idx) => (
                                                <tr key={idx} className="hover:bg-[#2a2a2a]">
                                                    <td className="border border-[#4a4a4a] px-2 py-1 text-white">{prop.propagation_id}</td>
                                                    <td className="border border-[#4a4a4a] px-2 py-1 text-white">{prop.propagation_level}</td>
                                                    <td className="border border-[#4a4a4a] px-2 py-1 font-mono text-white">{prop.datetime}</td>
                                                    <td className="border border-[#4a4a4a] px-2 py-1">
                                                        <span className={prop.trend_type > 0 ? 'text-green-600' : 'text-red-600'}>
                                                            {prop.trend_type > 0 ? '↑' : '↓'} {prop.trend_type}
                                                        </span>
                                                    </td>
                                                    <td className="border border-[#4a4a4a] px-2 py-1 text-white">{prop.higher_freq}</td>
                                                    <td className="border border-[#4a4a4a] px-2 py-1 text-white">{prop.lower_freq}</td>
                                                    <td className="border border-[#4a4a4a] px-2 py-1 text-white">{prop.open_price.toFixed(2)}</td>
                                                    <td className="border border-[#4a4a4a] px-2 py-1">
                                                        <span className={prop.directional_change_percent >= 0 ? 'text-green-600' : 'text-red-600'}>
                                                            {prop.directional_change_percent.toFixed(2)}%
                                                        </span>
                                                    </td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan={8} className="border border-[#4a4a4a] px-2 py-3 text-center text-[#707070]">
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
                            <File className="mx-auto mb-4 text-[#707070]" size={64} />
                            <h2 className="text-[#919191] text-xl mb-2">No CSV File Loaded</h2>
                            <p className="text-[#707070] mb-4">Select a file from the dropdown to begin</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
