"""
Scrap / Kabadiwala Dashboard - backend
Flask (REST API) + SQLite (database file: kabadiwala.db, created automatically)

Run:   python app.py            -> open http://127.0.0.1:5000
Demo:  python app.py --seed     -> adds sample entries (useful for screenshots)
"""
import os
import random
import re
import sqlite3
import sys
from datetime import date, datetime, timedelta

from flask import Flask, g, jsonify, request

# Always keep the database next to app.py, whatever folder you run from
DB_NAME = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kabadiwala.db")
MATERIALS = ["Paper", "Plastic", "Metal", "Glass"]

app = Flask(__name__, static_folder="static", static_url_path="")


# Allow the page to call this API even when it is opened from another port
# (for example VS Code Live Server on 5500). No extra package needed.
@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response


# ------------------------------------------------------------ DATABASE
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_NAME)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_error):
    conn = g.pop("db", None)
    if conn:
        conn.close()


def init_db():
    with sqlite3.connect(DB_NAME) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS scrap_entries (
                entry_id     INTEGER PRIMARY KEY AUTOINCREMENT,
                seller_name  TEXT NOT NULL,
                material     TEXT NOT NULL,
                weight_kg    REAL NOT NULL CHECK (weight_kg > 0),
                rate_per_kg  REAL NOT NULL CHECK (rate_per_kg > 0),
                entry_date   TEXT NOT NULL,
                total_amount REAL NOT NULL
            )""")


def rows(sql, params=()):
    return [dict(r) for r in get_db().execute(sql, params).fetchall()]


# ------------------------------------------------------------ VALIDATION
def validate(data):
    """Return (clean_values, errors). Same rules as the browser form."""
    errors, clean = {}, {}

    name = str(data.get("seller_name", "")).strip()
    if not re.fullmatch(r"[A-Za-z ]{2,50}", name):
        errors["seller_name"] = "Use 2 to 50 letters and spaces only."
    clean["seller_name"] = name

    material = data.get("material")
    if material not in MATERIALS:
        errors["material"] = "Choose a material."
    clean["material"] = material

    for field, label in (("weight_kg", "Weight"), ("rate_per_kg", "Rate")):
        try:
            value = float(data.get(field))
            if not 0 < value <= 10000:
                raise ValueError
            clean[field] = value
        except (TypeError, ValueError):
            errors[field] = f"{label} must be a number above 0 and up to 10000."

    try:
        d = datetime.strptime(str(data.get("entry_date")), "%Y-%m-%d").date()
        if d > date.today():
            errors["entry_date"] = "Date cannot be in the future."
        clean["entry_date"] = d.isoformat()
    except ValueError:
        errors["entry_date"] = "Enter a valid date."

    if not errors:
        clean["total_amount"] = round(clean["weight_kg"] * clean["rate_per_kg"], 2)
    return clean, errors


# ------------------------------------------------------------ ROUTES
@app.get("/")
def home():
    return app.send_static_file("index.html")


# READ
@app.get("/api/entries")
def list_entries():
    sql = "SELECT * FROM scrap_entries WHERE seller_name LIKE ?"
    params = [f"%{request.args.get('q', '').strip()}%"]
    material = request.args.get("material", "")
    if material in MATERIALS:
        sql += " AND material = ?"
        params.append(material)
    sql += " ORDER BY entry_date DESC, entry_id DESC"
    return jsonify(rows(sql, params))


# CREATE
@app.post("/api/entries")
def create_entry():
    clean, errors = validate(request.get_json(silent=True) or {})
    if errors:
        return jsonify(errors=errors), 400
    cur = get_db().execute(
        """INSERT INTO scrap_entries
           (seller_name, material, weight_kg, rate_per_kg, entry_date, total_amount)
           VALUES (:seller_name, :material, :weight_kg, :rate_per_kg, :entry_date, :total_amount)""",
        clean)
    get_db().commit()
    return jsonify(entry_id=cur.lastrowid), 201


# UPDATE
@app.put("/api/entries/<int:entry_id>")
def update_entry(entry_id):
    clean, errors = validate(request.get_json(silent=True) or {})
    if errors:
        return jsonify(errors=errors), 400
    clean["entry_id"] = entry_id
    cur = get_db().execute(
        """UPDATE scrap_entries SET seller_name=:seller_name, material=:material,
           weight_kg=:weight_kg, rate_per_kg=:rate_per_kg, entry_date=:entry_date,
           total_amount=:total_amount WHERE entry_id=:entry_id""", clean)
    get_db().commit()
    if cur.rowcount == 0:
        return jsonify(errors={"entry_id": "Entry not found."}), 404
    return jsonify(ok=True)


# DELETE
@app.delete("/api/entries/<int:entry_id>")
def delete_entry(entry_id):
    cur = get_db().execute("DELETE FROM scrap_entries WHERE entry_id = ?", (entry_id,))
    get_db().commit()
    if cur.rowcount == 0:
        return jsonify(errors={"entry_id": "Entry not found."}), 404
    return jsonify(ok=True)


# DASHBOARD DATA (totals, per-material summary, trend, top sellers)
@app.get("/api/summary")
def summary():
    by_material = rows("""SELECT material, ROUND(SUM(weight_kg), 2) AS weight,
                                 ROUND(SUM(total_amount), 2) AS amount, COUNT(*) AS entries
                          FROM scrap_entries GROUP BY material""")
    trend = rows("""SELECT entry_date AS date, ROUND(SUM(total_amount), 2) AS amount
                    FROM scrap_entries GROUP BY entry_date
                    ORDER BY entry_date DESC LIMIT 14""")[::-1]
    top_sellers = rows("""SELECT seller_name, ROUND(SUM(weight_kg), 2) AS weight,
                                 ROUND(SUM(total_amount), 2) AS amount
                          FROM scrap_entries GROUP BY LOWER(seller_name)
                          ORDER BY amount DESC LIMIT 5""")
    return jsonify(by_material=by_material, trend=trend, top_sellers=top_sellers)


# ------------------------------------------------------------ SAMPLE DATA
def seed():
    names = ["Ramesh Patil", "Sunita Jadhav", "Ajay Kale", "Meena Shinde",
             "Vijay More", "Pooja Pawar", "Santosh Gaikwad"]
    rates = {"Paper": 12, "Plastic": 18, "Metal": 38, "Glass": 5}
    random.seed(7)
    with sqlite3.connect(DB_NAME) as conn:
        for i in range(24):
            material = random.choice(MATERIALS)
            weight = round(random.uniform(3, 60), 1)
            rate = rates[material] + random.choice([-1, 0, 0, 1, 2])
            day = (date.today() - timedelta(days=random.randint(0, 13))).isoformat()
            conn.execute(
                """INSERT INTO scrap_entries
                   (seller_name, material, weight_kg, rate_per_kg, entry_date, total_amount)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (random.choice(names), material, weight, rate, day, round(weight * rate, 2)))
    print("Added 24 sample entries.")


if __name__ == "__main__":
    init_db()
    if "--seed" in sys.argv:
        seed()
    else:
        app.run(host="127.0.0.1", port=5000, debug=True)