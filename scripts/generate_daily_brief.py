#!/usr/bin/env python3
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import urlopen
from xml.etree import ElementTree as ET


SNAPSHOT_PATH = Path("/Users/jim/.hermes/data/bob_snapshot/latest_snapshot.json")
BACKUP_LOG_DIR = Path("/Users/jim/BOB-Backups/logs")
APP_BASE_URL = "https://bob.jc1.tech"
BRIEF_LOCATION_NAME = "London"
BRIEF_LAT = 51.5072
BRIEF_LON = -0.1276
NEWS_RSS_URL = "https://feeds.bbci.co.uk/news/rss.xml"

WORK_KEYWORDS = re.compile(
    r"\b(servicenow|service now|igm|cmdb|tpsm|discovery\s+scan|requirement|client|customer|"
    r"consultancy|sme|marketing|growth|substack|bob app|mark app|open claw|vault|"
    r"integration|implementation|contracts?|entitlements?|f24|professional|business)\b",
    re.IGNORECASE,
)

PERSONAL_KEYWORDS = re.compile(
    r"\b(personal|mum|dad|tax|utr|p60|companies house|bank|budget|estate planning|cat|"
    r"iphone|marathon|triathlon|travel|visa|volunteer|wardrobe|bathroom|garage|living room|"
    r"motor ?cycle|race|laundry|home|house|garden|charity|allstate)\b",
    re.IGNORECASE,
)


def load_snapshot():
    if not SNAPSHOT_PATH.exists():
        raise FileNotFoundError(f"Snapshot missing: {SNAPSHOT_PATH}")
    return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))


def normalize_persona(value):
    persona = str(value or "").strip().lower()
    return persona if persona in {"personal", "work"} else None


def latest_backup_summary():
    if not BACKUP_LOG_DIR.exists():
        return "Backup logs unavailable."
    logs = sorted([path for path in BACKUP_LOG_DIR.iterdir() if path.is_file()], reverse=True)
    if not logs:
        return "No recent backup logs found."
    latest = logs[0]
    lines = [line.strip() for line in latest.read_text(encoding="utf-8", errors="ignore").splitlines() if line.strip()]
    tail = lines[-1] if lines else "Backup log was empty."
    return f"{latest.name}: {tail[:180]}"


def fetch_weather_summary():
    params = urlencode({
        "latitude": BRIEF_LAT,
        "longitude": BRIEF_LON,
        "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        "timezone": "Europe/London",
        "forecast_days": 1,
    })
    url = f"https://api.open-meteo.com/v1/forecast?{params}"
    weather_codes = {
        0: "Clear",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Depositing rime fog",
        51: "Light drizzle",
        53: "Moderate drizzle",
        55: "Dense drizzle",
        61: "Slight rain",
        63: "Moderate rain",
        65: "Heavy rain",
        71: "Slight snow",
        73: "Moderate snow",
        75: "Heavy snow",
        80: "Rain showers",
        81: "Rain showers",
        82: "Heavy showers",
        95: "Thunderstorm",
    }
    try:
        with urlopen(url, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
        current = payload.get("current") or {}
        daily = payload.get("daily") or {}
        temp = current.get("temperature_2m")
        feels = current.get("apparent_temperature")
        code = int(current.get("weather_code", -1))
        wind = current.get("wind_speed_10m")
        max_temp = (daily.get("temperature_2m_max") or [None])[0]
        min_temp = (daily.get("temperature_2m_min") or [None])[0]
        rain_chance = (daily.get("precipitation_probability_max") or [None])[0]
        return (
            f"{BRIEF_LOCATION_NAME}: {weather_codes.get(code, 'Weather unavailable')} "
            f"{temp}C (feels {feels}C), high {max_temp}C, low {min_temp}C, "
            f"rain chance {rain_chance}%, wind {wind} km/h"
        )
    except (URLError, TimeoutError, ValueError, KeyError, json.JSONDecodeError):
        return f"{BRIEF_LOCATION_NAME}: Weather unavailable."


def fetch_news_summary(limit=3):
    try:
        with urlopen(NEWS_RSS_URL, timeout=10) as response:
            root = ET.fromstring(response.read())
        items = root.findall(".//item")[:limit]
        headlines = [str(item.findtext("title") or "").strip() for item in items if str(item.findtext("title") or "").strip()]
        if not headlines:
            return "News unavailable."
        return " | ".join(headlines)
    except (URLError, TimeoutError, ET.ParseError):
        return "News unavailable."


def latest_recovery_summary(snapshot):
    coach_daily = snapshot.get("health", {}).get("coach_daily") or {}
    if not isinstance(coach_daily, dict) or not coach_daily:
        return "Recovery data unavailable."
    latest_key = sorted(coach_daily.keys(), reverse=True)[0]
    latest = coach_daily.get(latest_key) or {}
    label = str(latest.get("readinessLabel") or "unknown").strip()
    score = latest.get("readinessScore")
    briefing = str(latest.get("briefingText") or "").strip().replace("\n", " ")
    parts = [f"{latest_key}"]
    if label:
        parts.append(label)
    if score is not None:
        parts.append(f"score={score}")
    summary = " · ".join(parts)
    if briefing:
        summary = f"{summary} · {briefing[:180]}"
    return summary


def current_month_spend_summary(snapshot):
    budget_summary = snapshot.get("finance", {}).get("budget_summary") or {}
    monthly = budget_summary.get("monthly") or {}
    month_key = datetime.now().strftime("%Y-%m")
    month_data = monthly.get(month_key) or {}
    if not month_data:
        return "Current-month spend unavailable."
    optional = float(month_data.get("optional", 0) or 0)
    mandatory = float(month_data.get("mandatory", 0) or 0)
    savings = float(month_data.get("savings", 0) or 0)
    income = float(month_data.get("income", 0) or 0)
    total_out = optional + mandatory + savings
    if total_out <= 0:
        return f"{month_key}: spend data unavailable."
    optional_pct = optional / total_out * 100
    mandatory_pct = mandatory / total_out * 100
    savings_pct = savings / total_out * 100
    spend_vs_income = (optional + mandatory) / income * 100 if income > 0 else None
    suffix = f", spend vs income {spend_vs_income:.0f}%" if spend_vs_income is not None else ""
    return (
        f"{month_key}: optional {optional_pct:.0f}%, mandatory {mandatory_pct:.0f}%, "
        f"savings {savings_pct:.0f}% of outgoings{suffix}"
    )


def is_open_item(item, entity_type):
    status = item.get("status")
    if isinstance(status, int):
        if entity_type == "task":
            return status in (0, 1)
        return status in (0, 1)
    normalized = str(status or "").strip().lower()
    if entity_type == "task":
        return normalized in {"todo", "to do", "in progress", "open", "backlog"}
    return normalized in {"backlog", "in progress", "planned", "open"}


def build_context_text(item, story_lookup, goal_lookup):
    parts = [
        item.get("title"),
        item.get("description"),
        item.get("ref"),
        item.get("persona"),
    ]
    goal = goal_lookup.get(item.get("goalId"))
    story = story_lookup.get(item.get("storyId"))
    if goal:
        parts.append(goal.get("title"))
        parts.append(goal.get("description"))
    if story:
        parts.append(story.get("title"))
        parts.append(story.get("description"))
    return " ".join(str(part or "") for part in parts)


def classify_persona(item, story_lookup, goal_lookup):
    explicit = normalize_persona(item.get("persona")) or normalize_persona(item.get("derivedPersona"))
    if explicit:
        return explicit
    goal = goal_lookup.get(item.get("goalId"))
    story = story_lookup.get(item.get("storyId"))
    inherited = normalize_persona((story or {}).get("persona")) or normalize_persona((story or {}).get("derivedPersona"))
    if inherited:
        return inherited
    inherited = normalize_persona((goal or {}).get("persona")) or normalize_persona((goal or {}).get("derivedPersona"))
    if inherited:
        return inherited
    context = build_context_text(item, story_lookup, goal_lookup)
    work_match = WORK_KEYWORDS.search(context)
    personal_match = PERSONAL_KEYWORDS.search(context)
    if work_match:
        return "work"
    if personal_match:
        return "personal"
    return "personal"


def entity_link(entity_type, item):
    slug = item.get("ref") or item.get("id") or "unknown"
    if entity_type == "story":
        return f"{APP_BASE_URL}/stories/{slug}"
    return f"{APP_BASE_URL}/tasks/{slug}"


def entity_due_date(item):
    for key in ("dueDateIso", "targetDateIso", "scheduledDate", "deadline"):
        value = item.get(key)
        if value:
            return str(value)
    for key in ("dueDateMs", "dueDate", "targetDate"):
        value = item.get(key)
        if isinstance(value, (int, float)) and value > 0:
            try:
                return datetime.fromtimestamp(value / 1000).strftime("%Y-%m-%d")
            except (ValueError, OSError):
                continue
        if value:
            return str(value)
    return "None"


def build_priority_candidates(snapshot):
    flat = snapshot.get("hierarchy", {}).get("flat", {})
    tasks = flat.get("tasks") or []
    stories = flat.get("stories") or []
    goal_lookup = {goal.get("id"): goal for goal in flat.get("goals") or [] if goal.get("id")}
    story_lookup = {story.get("id"): story for story in stories if story.get("id")}
    candidates = []

    for entity_type, items in (("task", tasks), ("story", stories)):
        for item in items:
            if not is_open_item(item, entity_type):
                continue
            score = item.get("aiCriticalityScore")
            if score is None:
                continue
            score = int(score)
            if score <= 0:
                continue
            candidates.append({
                "entityType": entity_type,
                "title": str(item.get("title") or "Untitled").strip(),
                "ref": item.get("ref") or item.get("id") or "Unknown",
                "aiCriticalityScore": score,
                "status": item.get("status"),
                "persona": classify_persona(item, story_lookup, goal_lookup),
                "link": entity_link(entity_type, item),
                "dueDate": entity_due_date(item),
            })
    return candidates


def top_three_by_persona(candidates, persona):
    filtered = [item for item in candidates if item["persona"] == persona]
    return sorted(
        filtered,
        key=lambda item: (-item["aiCriticalityScore"], item["title"].lower(), item["ref"]),
    )[:3]


def format_section(title, items):
    lines = [f"*{title}*"]
    if not items:
        lines.append("- No open AI-scored items found.")
        return "\n".join(lines)

    for index, item in enumerate(items, start=1):
        ref_link = f"[{item['ref']}]({item['link']})"
        lines.extend([
            f"{index}. Title: {item['title']}",
            f"   Ref hyperlink: {ref_link}",
            f"   Due date: {item['dueDate']}",
            f"   Link: {item['link']}",
            f"   AI score: {item['aiCriticalityScore']}",
        ])
    return "\n".join(lines)


def build_focus_sentence(personal_items, work_items, recovery_text, spend_text):
    personal_title = personal_items[0]["title"] if personal_items else "your most important personal item"
    work_title = work_items[0]["title"] if work_items else "your most important work item"
    prompt = (
        "Write one concise UK-English sentence telling Jim what to focus on first today. "
        "Prefer the personal item first, then note the top work item. "
        "Keep it under 28 words.\n"
        f"Personal top item: {personal_title}\n"
        f"Work top item: {work_title}\n"
        f"Recovery: {recovery_text}\n"
        f"Spend: {spend_text}\n"
    )
    try:
        result = subprocess.run(
            ["ollama", "run", "gemma4:e4b"],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        text = str(result.stdout or "").strip().splitlines()
        candidate = next((line.strip() for line in text if line.strip()), "")
        if candidate:
            return candidate[:220]
    except Exception:
        pass
    return f"Focus first on {personal_title}, then switch to {work_title} once the personal item is moved forward."


def generate_daily_brief():
    snapshot = load_snapshot()
    candidates = build_priority_candidates(snapshot)
    personal_items = top_three_by_persona(candidates, "personal")
    work_items = top_three_by_persona(candidates, "work")
    recovery_text = latest_recovery_summary(snapshot)
    spend_text = current_month_spend_summary(snapshot)
    weather_text = fetch_weather_summary()
    news_text = fetch_news_summary()
    focus_sentence = build_focus_sentence(personal_items, work_items, recovery_text, spend_text)

    captured_at = snapshot.get("captured_at") or "unknown"
    try:
        captured_display = datetime.fromisoformat(str(captured_at).replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        captured_display = str(captured_at)

    sections = [
        "*BOB 07:00 Brief*",
        f"Snapshot: {captured_display}",
        "",
        format_section("Personal Persona - Top 3", personal_items),
        "",
        format_section("Work Persona - Top 3", work_items),
        "",
        "*Signals*",
        f"- Focus: {focus_sentence}",
        f"- Weather: {weather_text}",
        f"- News: {news_text}",
        f"- Recovery: {recovery_text}",
        f"- Spending habits: {spend_text}",
        f"- Backup: {latest_backup_summary()}",
    ]
    return "\n".join(sections).strip()


if __name__ == "__main__":
    print(generate_daily_brief())
