# Stress Data Workspace

This folder is the default output location for generated large CSV fixtures used by project-owned stress checks.

Generated CSV files and `manifest.json` are intentionally ignored by Git to avoid committing large reproducible artifacts. Generate them locally with:

```bash
npm run stress:generate-data
```

Then import and validate with:

```bash
DATA_DIR=data_stress npm run data:import
npm run stress:validate-data
```

The official assignment `data/` and `tests/` folders are not modified by this workflow.