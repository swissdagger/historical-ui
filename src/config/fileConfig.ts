export interface FileConfig {
  filename: string;
  displayName: string;
}

export const fileConfigs: Record<string, FileConfig> = {
  'spy_etf_1s_combined_all_trends.csv': {
    filename: 'spy_etf_1s_combined_all_trends.csv',
    displayName: 'SPY ETF'
  }
};

export function getDisplayName(filename: string): string {
  const config = fileConfigs[filename];
  return config ? config.displayName : filename.replace(/\.csv$/i, '');
}
