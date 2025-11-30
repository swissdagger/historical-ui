# CSV Files Directory

Place your CSV files in this directory and update the `files.json` file to list them.

## Setup Instructions

1. Add your CSV files to this directory
2. Edit `files.json` to include the filenames
3. Edit `/src/config/fileConfig.ts` to configure display names for each file

Example `files.json`:
```json
[
  "spy_etf_1s_combined_all_trends.csv",
  "btc_usdt_1m_combined_all_trends.csv"
]
```

Example `fileConfig.ts`:
```typescript
export const fileConfigs: Record<string, FileConfig> = {
  'spy_etf_1s_combined_all_trends.csv': {
    filename: 'spy_etf_1s_combined_all_trends.csv',
    displayName: 'SPY ETF'
  },
  'btc_usdt_1m_combined_all_trends.csv': {
    filename: 'btc_usdt_1m_combined_all_trends.csv',
    displayName: 'BTC/USDT'
  }
};
```

## CSV Format Requirements

- **Required columns:** datetime, open, high, low, close
- **Datetime formats:** YYYY-MM-DD HH:mm:ss, DD-MM-YYYY HH:mm:ss, MM-DD-YYYY HH:mm:ss, DD/MM/YYYY HH:mm:ss, or MM/DD/YYYY HH:mm:ss
- **Optional prediction columns:** chain_detected_{number}{unit} where unit is s (seconds), m (minutes), or h (hours)
- **Examples:** chain_detected_30s, chain_detected_1m, chain_detected_5m, chain_detected_15m, chain_detected_1h
- **Prediction values:** -1 (negative), 0 (neutral), or 1 (positive)

## Features

- **Date Range Filter:** Focus on specific date ranges within your data
- **Timeframe Filter:** Show propagations for selected timeframes only
- **Configurable Display Names:** Set friendly names for files in the code (not editable on client side)
