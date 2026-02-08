# Health-Connect

GeoCare — an AI-powered healthcare facility discovery and ranking platform for Ghana. Users search for healthcare needs in natural language, and the system finds, filters, and ranks nearby facilities using LLM-based relevance scoring.

## Project Structure

```
Health-Connect/
├── webapp/                  # React + Vite frontend
│   ├── src/                 # React components, styles, assets
│   ├── public/              # Static assets
│   ├── package.json         # Node dependencies
│   └── vite.config.js       # Vite configuration
├── agentic_retrieval/       # Python backend — AI ranking pipeline
│   ├── ranking_agent.py     # Query → SQL → DB lookup → LLM ranking
│   ├── preprocessing.py     # Raw CSV → normalized SQLite database
│   ├── capabilities.py      # Healthcare capability vocabulary
│   ├── genie_client.py      # Databricks Genie NL→SQL client
│   ├── clients/             # LLM provider clients (OpenAI, Gemini)
│   ├── data/source/         # Raw facility CSV data
│   └── requirements.txt     # Python dependencies
├── geoutils.py              # Geospatial utility functions
├── pyproject.toml           # Python project config (uv)
└── README.md
```

## Prerequisites

- **Node.js** >= 18 and **npm**
- **Python** >= 3.12

## Webapp Setup

The webapp is a React + Vite application with Leaflet maps and TailwindCSS.

### 1. Install dependencies

```bash
cd webapp
npm install
```

### 2. Start the dev server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

### 3. Build for production

```bash
npm run build
npm run preview   # preview the production build locally
```

## Agentic Retrieval Setup

The backend pipeline handles data preprocessing, fact normalization, and AI-powered facility ranking.

### 1. Create a virtual environment and install dependencies

From the project root:

```bash
cd agentic_retrieval
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials:

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key for fact normalization and ranking |
| `OPENAI_MODEL` | No | Model override (default: `gpt-4o-mini`) |
| `DATABRICKS_HOST` | Yes | Databricks workspace URL |
| `DATABRICKS_TOKEN` | Yes | Databricks personal access token |
| `GENIE_SPACE_ID` | Yes | Databricks Genie space ID for NL→SQL |

### 3. Run the preprocessing pipeline

This normalizes raw facility data into a structured SQLite database with capability codes:

```bash
python preprocessing.py
```

The pipeline will:
1. Load and parse the source CSV from `data/source/`
2. Deduplicate facility records
3. Explode facts with provenance tracking
4. Normalize facts to capability codes via LLM
5. Output a SQLite database with queryable views

### 4. Run the ranking agent

```bash
python ranking_agent.py
```

This starts the facility ranking pipeline: user query → Databricks Genie SQL → database lookup → LLM relevance scoring.
