import React, { useEffect, useState, useCallback, useMemo } from 'react';
import ChartContainer from '../Chart/ChartContainer';
import QuadView from './QuadView';
import { getInitialTimeframes, calculateDataLimit, convertIntervalToMinutes } from '../../api/binanceAPI';
import { setSixteenTimesMode, subscribeToPredictionUpdates, loadPredictionsForTicker } from '../../services/predictionService';
import { TimeframeConfig, PredictionEntry } from '../../types';
import { SUPPORTED_PREDICTION_INTERVALS } from '../../api/sumtymeAPI';
import { Info, X, Grid3x3 as Grid3X3, File, ChevronDown, Calendar } from 'lucide-react';
import { getCSVMetadata, loadCSVFile, listLocalCSVFiles, loadLocalCSVFile } from '../../services/csvService';
import { extractTrendIndicators, InitialIndicator, Propagation } from '../../utils/indicatorAnalysis';
import { getDisplayName } from '../../config/fileConfig';

const Dashboard: React.FC = () => {
    const [currentFileId, setCurrentFileId] = useState<string>('');
    const [currentFilename, setCurrentFilename] = useState<string>('');
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [showHistoricalPerformance, setShowHistoricalPerformance] = useState(false);
    const [showQuadView, setShowQuadView] = useState(false);
    const [showAllInsights, setShowAllInsights] = useState(false);
    const [loadedFileIds, setLoadedFileIds] = useState<string[]>([]);
    const [availableFiles, setAvailableFiles] = useState<string[]>([]);
    const [showFileDropdown, setShowFileDropdown] = useState(false);
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [selectedTimeframes, setSelectedTimeframes] = useState<string[]>([]);
    const [availableTimeframes, setAvailableTimeframes] = useState<string[]>([]);

    const [userSelectedTimeframes, setUserSelectedTimeframes] = useState<TimeframeConfig[]>(
        getInitialTimeframes('DEFAULT', showHistoricalPerformance)
    );
    const [allPredictionsData, setAllPredictionsData] = useState<Record<string, Record<string, PredictionEntry[]>>>({});
    const [quadViewFileIds, setQuadViewFileIds] = useState<string[]>([]);

    const handleQuadViewFilesChange = useCallback((fileIds: string[]) => {
        setQuadViewFileIds(fileIds);
    }, []);

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

    const { initialIndicators, propagations } = useMemo(() => {
        if (!currentFileId || !allPredictionsData[currentFileId]) {
            return { initialIndicators: [], propagations: [] };
        }

        const filteredPredictions = { ...allPredictionsData[currentFileId] };

        const result = extractTrendIndicators(filteredPredictions);

        let filteredInitialIndicators = result.initialIndicators;
        let filteredPropagations = result.propagations;

        if (startDate || endDate) {
            const start = startDate ? new Date(startDate) : new Date(0);
            const end = endDate ? new Date(endDate) : new Date(8640000000000000);

            filteredInitialIndicators = filteredInitialIndicators.filter(ind => {
                const indDate = new Date(ind.datetime);
                return indDate >= start && indDate <= end;
            });

            filteredPropagations = filteredPropagations.filter(prop => {
                const propDate = new Date(prop.datetime);
                return propDate >= start && propDate <= end;
            });
        }

        if (selectedTimeframes.length > 0 && selectedTimeframes.length < availableTimeframes.length) {
            filteredPropagations = filteredPropagations.filter(prop =>
                selectedTimeframes.includes(prop.higher_freq) || selectedTimeframes.includes(prop.lower_freq)
            );
        }

        return { initialIndicators: filteredInitialIndicators, propagations: filteredPropagations };
    }, [currentFileId, allPredictionsData, startDate, endDate, selectedTimeframes, availableTimeframes]);

    return (
        <div className="bg-[#1a1a1a]">
            <div className="flex items-center justify-between bg-[#1a1a1a] border-b border-[#2a2a2a] px-2 py-0.5 md:px-4 md:py-1 sticky top-0 z-20">
                <div className="flex items-center space-x-2">
                    <div className="relative">
                        <button
                            onClick={() => setShowFileDropdown(prev => !prev)}
                            className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                        >
                            <File size={12} />
                            <span>{currentFilename ? getDisplayName(currentFilename) : 'Select File'}</span>
                            <ChevronDown size={12} />
                        </button>
                        {showFileDropdown && (
                            <div className="absolute top-full left-0 mt-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded shadow-lg z-50 min-w-[200px]">
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
                                    <div className="px-3 py-2 text-xs text-[#666]">
                                        No files available
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => setShowInfoModal(true)}
                        className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium bg-[#2a2a2a] text-[#999] hover:bg-[#3a3a3a] hover:text-white transition-colors"
                    >
                        <Info size={12} />
                        <span>Info</span>
                    </button>

                    <button
                        onClick={() => setShowQuadView(prev => !prev)}
                        className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium transition-colors ${showQuadView
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'bg-[#2a2a2a] text-[#999] hover:bg-[#3a3a3a] hover:text-white'
                            }`}
                    >
                        <Grid3X3 size={12} />
                        <span>Quad View</span>
                    </button>

                    <button
                        onClick={() => setShowAllInsights(prev => !prev)}
                        className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium transition-colors ${showAllInsights
                                ? 'bg-green-600 text-white hover:bg-green-700'
                                : 'bg-[#2a2a2a] text-[#999] hover:bg-[#3a3a3a] hover:text-white'
                            }`}
                    >
                        <span>All Insights</span>
                    </button>
                </div>

                <div className="flex items-center space-x-4">
                    {currentMetadata && (
                        <div className="flex items-center space-x-2 text-xs">
                            <span className="text-[#999]">{currentMetadata.rowCount.toLocaleString()} rows</span>
                        </div>
                    )}
                </div>
            </div>

            {showInfoModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg max-w-5xl w-full max-h-[80vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-4 border-b border-[#2a2a2a]">
                            <h2 className="text-white text-lg font-semibold">CSV Visualization Tool</h2>
                            <button
                                onClick={() => setShowInfoModal(false)}
                                className="text-[#999] hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 text-[#ccc] leading-relaxed">
                            <p className="text-white font-medium">
                                This tool visualises historical data from CSV files with forecasts from sumtyme.ai's Causal Intelligence Layer.
                            </p>

                            <div className="pt-4 border-t border-[#2a2a2a]">
                                <h3 className="text-white font-medium mb-2">How to Use</h3>
                                <ol className="list-decimal list-inside space-y-1 text-sm">
                                    <li>Select a file from the dropdown to load data</li>
                                    <li>Use date range and timeframe filters to focus on specific periods</li>
                                    <li>Enable "Quad View" to compare multiple CSV files side-by-side</li>
                                    <li>Turn on "All Insights" to see all prediction points instead of just propagations</li>
                                    <li>View Initial Indicators and Propagations tables below the chart</li>
                                </ol>
                            </div>

                            <div className="pt-4 border-t border-[#2a2a2a]">
                                <h3 className="text-white font-medium mb-2">Visualisation</h3>
                                <p className="text-sm">
                                    The chart displays the open price as a line. Green dots represent positive causal chain insights,
                                    whilst red dots represent negative causal chain insights. Predictions are plotted at the open price of
                                    the corresponding candle.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="pb-8">
                {showQuadView ? (
                    <div style={{ height: '100vh' }}>
                        <QuadView
                        userSelectedTimeframes={userSelectedTimeframes}
                        showHistoricalPerformance={showHistoricalPerformance}
                        onTimeframeUpdate={handleTimeframeUpdate}
                        onFilesChange={handleQuadViewFilesChange}
                        showAllInsights={showAllInsights}
                        loadedFileIds={loadedFileIds}
                        />
                    </div>
                ) : currentFileId ? (
                    <div className="bg-[#1a1a1a]">
                        <div className="bg-[#1a1a1a]" style={{ height: '100vh' }}>
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
                            />
                        </div>
                        <div className="bg-[#1a1a1a] border-t border-[#2a2a2a] p-4">
                            <div className="mb-4 flex flex-wrap gap-4">
                                <div className="flex items-center space-x-2">
                                    <Calendar size={14} className="text-[#999]" />
                                    <label className="text-white text-xs font-medium">DateTime Range:</label>
                                    <input
                                        type="datetime-local"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="px-2 py-1 text-xs bg-[#2a2a2a] text-white border border-[#3a3a3a] rounded focus:outline-none focus:border-blue-600"
                                        placeholder="Start DateTime"
                                    />
                                    <span className="text-[#999]">to</span>
                                    <input
                                        type="datetime-local"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        className="px-2 py-1 text-xs bg-[#2a2a2a] text-white border border-[#3a3a3a] rounded focus:outline-none focus:border-blue-600"
                                        placeholder="End DateTime"
                                    />
                                </div>
                                <div className="flex items-center space-x-2">
                                    <label className="text-white text-xs font-medium">Timeframes:</label>
                                    <div className="flex flex-wrap gap-1">
                                        {availableTimeframes.map((tf) => (
                                            <button
                                                key={tf}
                                                onClick={() => {
                                                    if (selectedTimeframes.includes(tf)) {
                                                        setSelectedTimeframes(prev => prev.filter(t => t !== tf));
                                                    } else {
                                                        setSelectedTimeframes(prev => [...prev, tf]);
                                                    }
                                                }}
                                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                                    selectedTimeframes.includes(tf)
                                                        ? 'bg-blue-600 text-white'
                                                        : 'bg-[#2a2a2a] text-[#999] hover:bg-[#3a3a3a]'
                                                }`}
                                            >
                                                {tf}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="mb-6">
                                <h3 className="text-white font-medium mb-3 text-sm">Initial Indicators</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-[#2a2a2a]">
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Datetime</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Value</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Timeframe</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">End Datetime</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {initialIndicators.length > 0 ? initialIndicators.map((ind, idx) => (
                                                <tr key={idx} className="hover:bg-[#2a2a2a]">
                                                    <td className="border border-[#3a3a3a] px-2 py-1 font-mono text-white">{ind.datetime}</td>
                                                    <td className="border border-[#3a3a3a] px-2 py-1">
                                                        <span className={ind.trend_type > 0 ? 'text-green-500' : 'text-red-500'}>
                                                            {ind.trend_type > 0 ? '↑' : '↓'} {ind.trend_type}
                                                        </span>
                                                    </td>
                                                    <td className="border border-[#3a3a3a] px-2 py-1 text-white">{ind.timeframe}</td>
                                                    <td className="border border-[#3a3a3a] px-2 py-1 font-mono text-white">{ind.end_datetime || 'N/A'}</td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan={4} className="border border-[#3a3a3a] px-2 py-3 text-center text-[#666]">
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
                                            <tr className="bg-[#2a2a2a]">
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Prop ID</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Level</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Datetime</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Value</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Higher Freq</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Lower Freq</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {propagations.length > 0 ? propagations.map((prop, idx) => (
                                                <tr key={idx} className="hover:bg-[#2a2a2a]">
                                                    <td className="border border-[#3a3a3a] px-2 py-1 text-white">{prop.propagation_id}</td>
                                                    <td className="border border-[#3a3a3a] px-2 py-1 text-white">{prop.propagation_level}</td>
                                                    <td className="border border-[#3a3a3a] px-2 py-1 font-mono text-white">{prop.datetime}</td>
                                                    <td className="border border-[#3a3a3a] px-2 py-1">
                                                        <span className={prop.trend_type > 0 ? 'text-green-500' : 'text-red-500'}>
                                                            {prop.trend_type > 0 ? '↑' : '↓'} {prop.trend_type}
                                                        </span>
                                                    </td>
                                                    <td className="border border-[#3a3a3a] px-2 py-1 text-white">{prop.higher_freq}</td>
                                                    <td className="border border-[#3a3a3a] px-2 py-1 text-white">{prop.lower_freq}</td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan={6} className="border border-[#3a3a3a] px-2 py-3 text-center text-[#666]">
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
                            <File className="mx-auto mb-4 text-[#666]" size={64} />
                            <h2 className="text-white text-xl mb-2">No CSV File Loaded</h2>
                            <p className="text-[#999] mb-4">Select a file from the dropdown to begin</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
