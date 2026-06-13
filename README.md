# Intake

Patient-owned health intelligence workspace.

## Setup

```bash
npm install
cp .env.example .env.local   # optional: add XAI_API_KEY for AI extraction
npm run dev
```

Requires Node 20+. Open [http://localhost:3000](http://localhost:3000).

## Flow

1. **Sign in or create an account** at `/login`
2. **Import medical records** — upload a JSON EMR export
3. **Add voice notes** — record or type patient-reported context
4. **Submit clinician notes** — structured entry from visits
5. **Review** timeline, knowledge graph, risk alerts, and specialty reports
6. **Sign out** when done — data persists per account in local storage

## EMR file format

Upload JSON with any of these arrays:

```json
{
  "conditions": [{ "label": "...", "onset": "2024-01-01", "status": "active" }],
  "medications": [{ "label": "...", "dose": "...", "start": "2024-01-01" }],
  "labs": [{ "label": "...", "value": 5.2, "unit": "...", "date": "2024-01-01" }],
  "vitals": [{ "label": "Blood pressure", "value": "120/80", "date": "2024-01-01" }],
  "encounters": [{ "label": "...", "clinician": "...", "date": "2024-01-01" }],
  "careTasks": [{ "label": "...", "due": "2024-01-01" }]
}
```
