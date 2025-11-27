# CSV Files Directory

Place your CSV files in this directory and update the `files.json` file to list them.

## Setup Instructions

1. Add your CSV files to this directory
2. Edit `files.json` to include the filenames

Example `files.json`:
```json
[
  "BTCUSDT_1m_combined_all_trends.csv",
  "ETHUSDT_1m_combined_all_trends.csv"
]
```

## CSV Format Requirements

- **Required columns:** datetime, open, high, low, close
- **Datetime formats:** YYYY-MM-DD HH:mm:ss, DD-MM-YYYY HH:mm:ss, MM-DD-YYYY HH:mm:ss, DD/MM/YYYY HH:mm:ss, or MM/DD/YYYY HH:mm:ss
- **Optional prediction columns:** chain_detected_{number}{unit} where unit is s (seconds), m (minutes), or h (hours)
- **Examples:** chain_detected_30s, chain_detected_1m, chain_detected_5m, chain_detected_15m, chain_detected_1h
- **Prediction values:** -1 (negative), 0 (neutral), or 1 (positive)
