# Kabadiwala Dashboard

Scrap / Kabadiwala record manager with a web dashboard.

- Front end: HTML, CSS, JavaScript, Chart.js
- Back end: Python Flask (REST API)
- Database: SQLite (kabadiwala.db, created automatically)

## Run
1. pip install -r requirements.txt
2. python app.py
3. Open http://127.0.0.1:5000

Optional sample data for screenshots: python app.py --seed (run once, then python app.py)

## Structure
app.py            API, validation, database
static/index.html page structure
static/style.css  styling
static/script.js  form validation, charts, API calls
