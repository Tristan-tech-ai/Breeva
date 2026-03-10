# VAYU Engine — Python Workspace

Python backend for Breeva's air quality intelligence engine (Mode B).

Used for:
- Full CALINE3 line-source dispersion (background compute via GitHub Actions)
- ML training & inference (XGBoost correction model)
- OSM data processing (road segment extraction)
- TomTom/WAQI calibration pipelines
- Data export (Parquet history)

## Setup

```powershell
cd vayu
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Structure

```
vayu/
├── core/           # Core computation modules
├── ml/             # Machine learning (Phase 0.5+)
├── calibration/    # Traffic & AQ calibration
├── jobs/           # GitHub Actions entry points
└── tests/          # Unit tests
```
