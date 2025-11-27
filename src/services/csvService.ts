import { parseCSVFile, convertToChartData, extractPredictions, ParsedCSVRow } from '../utils/csvParser';
import { CandlestickData, PredictionEntry } from '../types';

export interface CSVFileMetadata {
  id: string;
  filename: string;
  fileSize: number;
  rowCount: number;
  datetimeFormat: string;
  startDate: Date;
  endDate: Date;
  availableTimeframes: string[];
  uploadedAt: Date;
}

const csvDataCache = new Map<string, CandlestickData[]>();
const csvPredictionsCache = new Map<string, Map<string, PredictionEntry[]>>();
const csvMetadataCache = new Map<string, CSVFileMetadata>();

type CSVDataCallback = () => void;
const csvDataCallbacks: CSVDataCallback[] = [];

export async function loadLocalCSVFile(filename: string): Promise<{ success: boolean; fileId?: string; error?: string }> {
  try {
    const response = await fetch(`/csv_files/${filename}`);

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to load file: ${filename}`
      };
    }

    const blob = await response.blob();
    const file = new File([blob], filename, { type: 'text/csv' });

    const parseResult = await parseCSVFile(file);

    if (!parseResult.success || !parseResult.data) {
      return {
        success: false,
        error: parseResult.error || 'Failed to parse CSV file'
      };
    }

    const { data: parsedData, availableTimeframes, datetimeFormat, startDate, endDate } = parseResult;

    const fileId = filename.replace(/\.csv$/i, '');

    const chartData = convertToChartData(parsedData);
    csvDataCache.set(fileId, chartData);

    const predictions = extractPredictions(parsedData, fileId);
    csvPredictionsCache.set(fileId, predictions);

    const metadata: CSVFileMetadata = {
      id: fileId,
      filename: filename,
      fileSize: file.size,
      rowCount: parsedData.length,
      datetimeFormat: datetimeFormat!,
      startDate: startDate!,
      endDate: endDate!,
      availableTimeframes: availableTimeframes || [],
      uploadedAt: new Date()
    };
    csvMetadataCache.set(fileId, metadata);

    notifyCSVDataUpdates();

    return {
      success: true,
      fileId
    };

  } catch (error) {
    console.error('Error loading CSV file:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

export async function listLocalCSVFiles(): Promise<string[]> {
  try {
    const response = await fetch('/csv_files/files.json');
    if (!response.ok) {
      console.error('Failed to load files.json. Create /public/csv_files/files.json with an array of filenames.');
      return [];
    }
    const files = await response.json();
    return files;
  } catch (error) {
    console.error('Error listing CSV files:', error);
    return [];
  }
}

export async function loadCSVFile(fileId: string): Promise<{ success: boolean; error?: string }> {
  if (csvDataCache.has(fileId) && csvPredictionsCache.has(fileId)) {
    return { success: true };
  }

  return await loadLocalCSVFile(`${fileId}.csv`);
}

export function getCSVData(fileId: string): CandlestickData[] {
  return csvDataCache.get(fileId) || [];
}

export function getCSVPredictions(fileId: string, timeframe?: string): PredictionEntry[] {
  const filePredictions = csvPredictionsCache.get(fileId);
  if (!filePredictions) return [];

  if (timeframe) {
    return filePredictions.get(timeframe) || [];
  }

  const allPredictions: PredictionEntry[] = [];
  filePredictions.forEach(predictions => {
    allPredictions.push(...predictions);
  });
  return allPredictions;
}

export function getCSVMetadata(fileId: string): CSVFileMetadata | undefined {
  return csvMetadataCache.get(fileId);
}

export function getAllLoadedFiles(): CSVFileMetadata[] {
  return Array.from(csvMetadataCache.values());
}

export function subscribeToCSVDataUpdates(callback: CSVDataCallback): () => void {
  csvDataCallbacks.push(callback);

  return () => {
    const index = csvDataCallbacks.indexOf(callback);
    if (index !== -1) {
      csvDataCallbacks.splice(index, 1);
    }
  };
}

function notifyCSVDataUpdates(): void {
  csvDataCallbacks.forEach(callback => callback());
}

export function clearAllCSVData(): void {
  csvDataCache.clear();
  csvPredictionsCache.clear();
  csvMetadataCache.clear();
  notifyCSVDataUpdates();
}
