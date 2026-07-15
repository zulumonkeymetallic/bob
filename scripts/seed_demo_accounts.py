#!/usr/bin/env python3
"""
Provisions two isolated Firebase Auth + Firestore accounts in bob20250810 with
a synthetic, human-relatable dataset (~10% of Jim's real data volume). Zero
content is derived from Jim's real data — everything here is fabricated.

Accounts:
  - demo-user-jc1-tech  (demo@jc1.tech)      — customer-facing demo account
  - ai-test-user-12345abcdef (ai-test-agent@bob.local) — agent QA account

Both get the IDENTICAL synthetic dataset (per Jim's decision).
"""
import datetime
import random
import secrets
import string

import firebase_admin
from firebase_admin import credentials, firestore, auth

SA = '/Users/jim/Library/Mobile Documents/com~apple~CloudDocs/secret/bob/bob20250810-firebase-adminsdk-fbsvc-7cf403c534.json'

if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(SA))
db = firestore.client()

random.seed(42)  # deterministic content, still "random-looking"

NOW = datetime.datetime(2026, 7, 15, 9, 0, 0, tzinfo=datetime.timezone.utc)


def ms(dt):
    return int(dt.timestamp() * 1000)


def days_ago(n, hour=9, minute=0):
    return (NOW - datetime.timedelta(days=n)).replace(hour=hour, minute=minute, second=0, microsecond=0)


def days_from_now(n, hour=9, minute=0):
    return (NOW + datetime.timedelta(days=n)).replace(hour=hour, minute=minute, second=0, microsecond=0)


def ref(prefix, n):
    return f"{prefix}-{n:05d}"


# ── Theme ids (GLOBAL_THEMES) ────────────────────────────────────────────────
TH_GENERAL, TH_HEALTH, TH_CAREER, TH_FINANCE, TH_LEARNING, TH_FAMILY, TH_HOBBIES, \
    TH_TRAVEL, TH_HOME, TH_SPIRITUAL, TH_CHORES, TH_REST, TH_WORK, TH_SLEEP, TH_RANDOM, TH_SIDEGIG = range(16)

_ref_counters = {'GR': 40000, 'ST': 60000, 'TK': 80000, 'SP': 10000}


def next_ref(prefix):
    _ref_counters[prefix] += 1
    return ref(prefix, _ref_counters[prefix])


# ── 1. Goals (with 3 Ironman phase sub-goals) ────────────────────────────────
def build_goals():
    goals = []

    ironman_id = 'seed-goal-ironman'
    goals.append({
        '_id': ironman_id, 'ref': next_ref('GR'), 'persona': 'personal',
        'title': 'Complete a full Ironman triathlon', 'theme': TH_HEALTH,
        'description': 'Train for and finish a full-distance Ironman by the end of the year.',
        'size': 3, 'confidence': 2, 'status': 1, 'goalKind': 'umbrella', 'timeHorizon': 'year',
        'parentGoalId': None, 'startDate': ms(days_ago(180)), 'endDate': ms(days_from_now(150)),
        'targetDate': (NOW + datetime.timedelta(days=150)).date().isoformat(), 'orderIndex': 0,
    })
    phases = [
        ('seed-goal-ironman-base', 'Base Building Phase', 2, -180, -90),
        ('seed-goal-ironman-build', 'Build Phase — bike & run volume', 1, -90, 0),
        ('seed-goal-ironman-race', 'Race Prep & Taper', 0, 0, 90),
    ]
    for pid, title, status, start_off, end_off in phases:
        goals.append({
            '_id': pid, 'ref': next_ref('GR'), 'persona': 'personal',
            'title': title, 'theme': TH_HEALTH, 'description': f'{title} of Ironman training.',
            'size': 2, 'confidence': 2, 'status': status, 'goalKind': 'milestone', 'timeHorizon': 'quarter',
            'parentGoalId': ironman_id, 'startDate': ms(days_ago(-start_off) if start_off < 0 else days_from_now(start_off)),
            'endDate': ms(days_ago(-end_off) if end_off < 0 else days_from_now(end_off)),
            'targetDate': None, 'orderIndex': 0,
        })

    simple_goals = [
        ('seed-goal-house', 'Save £10,000 house deposit', TH_FINANCE, 1, 'quarter'),
        ('seed-goal-spanish', 'Learn conversational Spanish', TH_LEARNING, 1, 'year'),
        ('seed-goal-reading', 'Read 24 books this year', TH_LEARNING, 1, 'year'),
        ('seed-goal-sidegig', 'Launch a side consulting business', TH_SIDEGIG, 0, 'year'),
        ('seed-goal-kitchen', 'Renovate the kitchen', TH_HOME, 0, 'quarter'),
        ('seed-goal-sleep', 'Improve sleep quality and recovery', TH_REST, 1, 'quarter'),
        ('seed-goal-japan', 'Visit Japan', TH_TRAVEL, 0, 'year'),
        ('seed-goal-family', 'Strengthen family relationships', TH_FAMILY, 1, 'year'),
        ('seed-goal-promo', 'Get promoted to Senior Consultant', TH_CAREER, 1, 'year'),
    ]
    for gid, title, theme, status, horizon in simple_goals:
        persona = 'work' if gid == 'seed-goal-promo' else 'personal'
        goals.append({
            '_id': gid, 'ref': next_ref('GR'), 'persona': persona,
            'title': title, 'theme': theme, 'description': f'Goal: {title}.',
            'size': 2, 'confidence': 2, 'status': status, 'goalKind': 'execution', 'timeHorizon': horizon,
            'parentGoalId': None, 'startDate': ms(days_ago(60)), 'endDate': ms(days_from_now(240)),
            'targetDate': None, 'orderIndex': 0,
        })
    return goals


# ── 2. Stories (+ tasks) per goal ────────────────────────────────────────────
# Story status is the CANONICAL 3-lane convention used by dashboards/kanban counts:
# 0=Backlog, 2=In Progress, 4=Done. (Deliberately skips 1/3 — those are a dead
# alternate convention used only by one legacy table, per schema investigation.)
STORY_BACKLOG, STORY_ACTIVE, STORY_DONE = 0, 2, 4

STORY_TEMPLATES = {
    'seed-goal-ironman-base': [
        (STORY_DONE, 'Complete 12-week base training block', ['Run 5k easy pace', 'Swim 1500m technique session', 'Bike 40km Zone 2']),
        (STORY_DONE, 'Build swim technique — front crawl', ['Swim drills: catch-up drill', 'Video review swim stroke']),
        (STORY_DONE, 'First open water swim', ['Buy triathlon wetsuit', 'Open water swim 750m']),
    ],
    'seed-goal-ironman-build': [
        (STORY_ACTIVE, '100km long ride', ['Bike 60km Zone 2', 'Bike 100km long ride']),
        (STORY_ACTIVE, 'Half marathon training run', ['Run 10km tempo', 'Run half marathon distance']),
        (STORY_DONE, 'Register for Ironman UK 70.3', ['Research race calendar', 'Complete race registration']),
        (STORY_BACKLOG, 'Nutrition strategy for race day', ['Trial race-day nutrition on long ride']),
    ],
    'seed-goal-ironman-race': [
        (STORY_BACKLOG, 'Taper plan and race logistics', ['Book race travel', 'Pack transition bags']),
    ],
    'seed-goal-house': [
        (STORY_DONE, 'Open high-interest savings account', ['Compare savings account rates', 'Open new savings account']),
        (STORY_DONE, 'Set up automatic monthly transfer', ['Set up standing order to savings']),
        (STORY_ACTIVE, 'Review and cut discretionary spending', ['Audit last 3 months of spending', 'Cancel unused subscriptions']),
        (STORY_BACKLOG, 'Research mortgage brokers', ['Get 3 broker recommendations', 'Book mortgage broker call']),
        (STORY_BACKLOG, 'Get mortgage agreement in principle', ['Gather 3 months bank statements']),
    ],
    'seed-goal-spanish': [
        (STORY_ACTIVE, 'Complete Duolingo 30-day streak', ['Duolingo lesson', 'Duolingo lesson', 'Duolingo lesson']),
        (STORY_ACTIVE, 'Book conversation exchange sessions', ['Find language exchange partner', 'Attend conversation session']),
        (STORY_BACKLOG, 'Watch a film in Spanish with subtitles', ['Pick a Spanish film to watch']),
        (STORY_ACTIVE, 'Learn 100 common verbs', ['Flashcard review session']),
    ],
    'seed-goal-reading': [
        (STORY_ACTIVE, 'Finish current fiction book', ['Read for 30 minutes']),
        (STORY_BACKLOG, 'Start a non-fiction book this month', ['Pick next non-fiction book']),
    ],
    'seed-goal-sidegig': [
        (STORY_BACKLOG, 'Design logo and brand', ['Sketch logo concepts', 'Pick brand colour palette']),
        (STORY_BACKLOG, 'Build simple website', ['Choose website builder', 'Draft homepage copy']),
        (STORY_BACKLOG, 'Get first paying client', ['List services on LinkedIn']),
        (STORY_BACKLOG, 'Set up business bank account', ['Research business bank accounts']),
        (STORY_BACKLOG, 'Register as sole trader', ['Register with HMRC']),
    ],
    'seed-goal-kitchen': [
        (STORY_BACKLOG, 'Get 3 quotes from contractors', ['Call local kitchen fitters']),
        (STORY_BACKLOG, 'Choose kitchen units', ['Visit kitchen showroom']),
        (STORY_BACKLOG, 'Book plumber for pipework', ['Get plumber quote']),
    ],
    'seed-goal-sleep': [
        (STORY_ACTIVE, 'Establish consistent wind-down routine', ['No screens after 10pm', 'Read before bed']),
        (STORY_DONE, 'Track sleep for 30 days', ['Log sleep quality daily']),
    ],
    'seed-goal-japan': [
        (STORY_BACKLOG, 'Research itinerary — Tokyo & Kyoto', ['Shortlist neighbourhoods to stay in']),
        (STORY_BACKLOG, 'Save for flights', ['Set up Japan trip savings pot']),
    ],
    'seed-goal-family': [
        (STORY_ACTIVE, 'Weekly family dinner', ['Plan Sunday family dinner', 'Plan Sunday family dinner']),
        (STORY_ACTIVE, 'Plan a weekend trip with the kids', ['Research family day-trip ideas']),
    ],
    'seed-goal-promo': [
        (STORY_ACTIVE, 'Deliver Q3 client project on time', ['Draft project plan', 'Weekly client status update']),
        (STORY_BACKLOG, 'Get promotion case reviewed by manager', ['Draft promotion case doc']),
        (STORY_ACTIVE, 'Complete leadership training course', ['Complete module 1', 'Complete module 2']),
    ],
}

TASK_TYPE_BY_TITLE_HINT = {
    'Duolingo lesson': ('habit', 'daily', None),
    'Plan Sunday family dinner': ('routine', 'weekly', ['sun']),
    'Weekly client status update': ('routine', 'weekly', ['fri']),
}

STANDALONE_RECURRING_TASKS = [
    ('Take vitamins', 'habit', 'daily', None, TH_HEALTH),
    ('Do the laundry', 'chore', 'weekly', ['sat'], TH_CHORES),
    ('Meal prep for the week', 'chore', 'weekly', ['sun'], TH_CHORES),
    ('Water the plants', 'chore', 'weekly', ['wed'], TH_CHORES),
    ('Meditate 10 minutes', 'habit', 'daily', None, TH_SPIRITUAL),
    ('Review weekly budget', 'routine', 'weekly', ['sun'], TH_FINANCE),
]


# Task status (unambiguous, cross-confirmed across dashboards): 0=To Do, 1=In
# Progress, 2=Done, 3=Blocked.
def _task_status_for_story(story_status):
    if story_status == STORY_DONE:
        return random.choice([2, 2, 1])
    if story_status == STORY_ACTIVE:
        return random.choice([0, 1, 1])
    return 0


def _sprint_for_story(goal, story_status, sprint_ids):
    if goal['persona'] == 'work':
        return sprint_ids['work']
    if story_status == STORY_ACTIVE:
        return sprint_ids['active']
    if story_status == STORY_DONE:
        return sprint_ids['past']
    return None  # backlog stays unscheduled, same as a real backlog


def build_stories_and_tasks(goals, sprint_ids):
    goal_by_id = {g['_id']: g for g in goals}
    stories, tasks = [], []
    for goal_id, story_templates in STORY_TEMPLATES.items():
        goal = goal_by_id[goal_id]
        for i, (status, title, task_titles) in enumerate(story_templates):
            sid = f"{goal_id}-story-{i}"
            due_offset = random.randint(-30, 60)
            sprint_id = _sprint_for_story(goal, status, sprint_ids)
            stories.append({
                '_id': sid, 'ref': next_ref('ST'), 'persona': goal['persona'],
                'title': title, 'description': f'{title}.', 'goalId': goal_id, 'theme': goal['theme'],
                'status': status, 'priority': random.choice([1, 2, 2, 3]), 'points': random.choice([2, 3, 5, 8]),
                'sprintId': sprint_id, 'orderIndex': i, 'acceptanceCriteria': [], 'tags': [],
                'dueDate': ms(days_ago(-due_offset) if due_offset < 0 else days_from_now(due_offset)),
                'targetDate': ms(days_ago(-due_offset) if due_offset < 0 else days_from_now(due_offset)),
            })
            for j, ttitle in enumerate(task_titles):
                ttype, freq, dow = 'task', None, []
                if ttitle in TASK_TYPE_BY_TITLE_HINT:
                    ttype, freq, dow = TASK_TYPE_BY_TITLE_HINT[ttitle]
                t_status = _task_status_for_story(status)
                due_off_t = random.randint(-14, 30)
                due_dt = days_ago(-due_off_t) if due_off_t < 0 else days_from_now(due_off_t)
                tasks.append({
                    '_id': f"{sid}-task-{j}", 'ref': next_ref('TK'), 'persona': goal['persona'],
                    'parentType': 'story', 'parentId': sid, 'storyId': sid, 'sprintId': sprint_id,
                    'title': ttitle, 'description': '', 'type': ttype, 'status': t_status,
                    'priority': random.choice([1, 2, 2, 3]), 'effort': random.choice(['S', 'M', 'L']),
                    'estimateMin': random.choice([15, 30, 45, 60, 90]), 'points': random.choice([0.5, 1, 2]),
                    'theme': goal['theme'], 'dueDate': ms(due_dt), 'dueDateMs': ms(due_dt),
                    'repeatFrequency': freq, 'repeatInterval': 1 if freq else None,
                    'daysOfWeek': dow or [], 'alignedToGoal': True, 'hasGoal': True, 'source': 'web',
                    'syncState': 'clean', 'createdAtMs': ms(days_ago(due_off_t + 20)),
                })

    for i, (title, ttype, freq, dow, theme) in enumerate(STANDALONE_RECURRING_TASKS):
        tasks.append({
            '_id': f"seed-standalone-task-{i}", 'ref': next_ref('TK'), 'persona': 'personal',
            'parentType': None, 'parentId': None, 'storyId': None,
            'title': title, 'description': '', 'type': ttype, 'status': 0,
            'priority': 3, 'effort': 'S', 'estimateMin': 15, 'points': 0.5,
            'theme': theme, 'dueDate': ms(days_from_now(1)), 'dueDateMs': ms(days_from_now(1)),
            'repeatFrequency': freq, 'repeatInterval': 1, 'daysOfWeek': dow or [],
            'alignedToGoal': False, 'hasGoal': False, 'source': 'web', 'syncState': 'clean',
            'createdAtMs': ms(days_ago(60)),
        })
    return stories, tasks


# ── 3. Sprints ────────────────────────────────────────────────────────────────
def build_sprints():
    return [
        {'_id': 'seed-sprint-past', 'ref': next_ref('SP'), 'name': 'Sprint 22 — Base Block', 'persona': 'personal',
         'status': 2, 'startDate': ms(days_ago(28)), 'endDate': ms(days_ago(14)), 'capacityPoints': 40},
        {'_id': 'seed-sprint-active', 'ref': next_ref('SP'), 'name': 'Sprint 23 — Build Block', 'persona': 'personal',
         'status': 1, 'startDate': ms(days_ago(7)), 'endDate': ms(days_from_now(7)), 'capacityPoints': 40},
        {'_id': 'seed-sprint-future', 'ref': next_ref('SP'), 'name': 'Sprint 24 — Taper', 'persona': 'personal',
         'status': 0, 'startDate': ms(days_from_now(8)), 'endDate': ms(days_from_now(22)), 'capacityPoints': 30},
        {'_id': 'seed-sprint-work', 'ref': next_ref('SP'), 'name': 'Work Q3', 'persona': 'work',
         'status': 1, 'startDate': ms(days_ago(14)), 'endDate': ms(days_from_now(76)), 'capacityPoints': 60},
    ]


SPRINT_ID_KEYS = {'seed-sprint-past': 'past', 'seed-sprint-active': 'active',
                  'seed-sprint-future': 'future', 'seed-sprint-work': 'work'}


# ── 4. theme_allocations ──────────────────────────────────────────────────────
def build_theme_allocations():
    allocations = []
    for dow in [1, 2, 3, 4, 5]:  # Mon-Fri
        allocations.append({'dayOfWeek': dow, 'startTime': '09:00', 'endTime': '17:30', 'theme': 'Work (Main Gig)', 'subTheme': None})
        allocations.append({'dayOfWeek': dow, 'startTime': '06:00', 'endTime': '07:00', 'theme': 'Health & Fitness', 'subTheme': 'Training'})
        allocations.append({'dayOfWeek': dow, 'startTime': '21:30', 'endTime': '22:30', 'theme': 'Rest & Recovery', 'subTheme': None})
    allocations.append({'dayOfWeek': 6, 'startTime': '09:00', 'endTime': '11:00', 'theme': 'Chores', 'subTheme': None})
    allocations.append({'dayOfWeek': 6, 'startTime': '08:00', 'endTime': '10:30', 'theme': 'Health & Fitness', 'subTheme': 'Long ride'})
    allocations.append({'dayOfWeek': 0, 'startTime': '13:00', 'endTime': '16:00', 'theme': 'Family & Relationships', 'subTheme': None})
    return {'allocations': allocations, 'weeklyOverrides': {}, 'updatedAt': NOW.isoformat()}


# ── 5. Finance: monzo_transactions ────────────────────────────────────────────
MERCHANTS_RECURRING_MONTHLY = [
    ('RENT PAYMENT', -1200.00, 'bills', False),
    ('COUNCIL TAX', -140.00, 'bills', False),
    ('BRITISH GAS', -85.00, 'bills', False),
    ('THAMES WATER', -45.00, 'bills', False),
    ('NETFLIX', -15.99, 'subscriptions', True),
    ('SPOTIFY', -10.99, 'subscriptions', True),
    ('PURE GYM', -24.99, 'subscriptions', True),
    ('SALARY - EMPLOYER LTD', 3200.00, 'transfers', False),
]
MERCHANTS_WEEKLY = [
    ('TESCO', -55.00, 'groceries'), ('SAINSBURYS', -40.00, 'groceries'),
    ('TFL TRAVEL', -35.00, 'transport'),
]
MERCHANTS_FREQUENT = [
    ('COSTA COFFEE', -4.50, 'eating_out'), ('PRET A MANGER', -7.20, 'eating_out'),
    ('UBER', -12.00, 'transport'), ('DECATHLON', -28.00, 'shopping'),
]
MERCHANTS_OCCASIONAL = [
    ('AMAZON', -30.00, 'shopping'), ('ASOS', -45.00, 'shopping'),
    ('VUE CINEMA', -12.00, 'entertainment'), ('WAGAMAMA', -22.00, 'eating_out'),
]


def build_transactions():
    txns = []
    for day_offset in range(90, -1, -1):
        d = days_ago(day_offset, hour=random.randint(7, 21), minute=random.randint(0, 59))
        wd = d.weekday()  # 0=Mon

        if d.day in (1, 2):
            for name, amt, cat, sub in MERCHANTS_RECURRING_MONTHLY:
                txns.append((name, amt, cat, sub, d))

        if wd == 5:  # Saturday
            for name, amt, cat in MERCHANTS_WEEKLY:
                txns.append((name, amt * random.uniform(0.85, 1.15), cat, False, d))

        if random.random() < 0.55:
            name, amt, cat = random.choice(MERCHANTS_FREQUENT)
            txns.append((name, round(amt * random.uniform(0.8, 1.3), 2), cat, False, d))

        if random.random() < 0.12:
            name, amt, cat = random.choice(MERCHANTS_OCCASIONAL)
            txns.append((name, round(amt * random.uniform(0.7, 1.5), 2), cat, False, d))

    out = []
    for i, (name, amt, cat, is_sub, d) in enumerate(txns):
        amt = round(amt, 2)
        out.append({
            '_id': f'seed-txn-{i:05d}', 'accountId': 'acc_seed0000000001',
            'transactionId': f'tx_seed_{i:06d}', 'amountMinor': int(round(amt * 100)),
            'amount': amt, 'currency': 'GBP', 'description': name, 'category': cat,
            'notes': None, 'isLoad': False, 'isSettled': True,
            'settledISO': d.isoformat(), 'createdISO': d.isoformat(), 'createdAtDt': d,
            'merchant': {'id': f'merch_seed_{abs(hash(name)) % 100000}', 'name': name.title(), 'emoji': None, 'logo': None, 'category': cat},
            'merchantKey': name.lower(), 'defaultCategoryType': 'optional', 'defaultCategoryLabel': name.title(),
            'userCategoryType': None, 'userCategoryLabel': None, 'isSubscription': is_sub,
            'monthKey': d.strftime('%Y-%m'),
        })
    return out


# ── 6. Health: metrics_hrv, metrics_workouts, health_metrics ────────────────
WORKOUT_TYPES = [
    ('Run', 5000, 1500, 155), ('Run', 10000, 3000, 150), ('Bike', 40000, 5400, 138),
    ('Bike', 100000, 13500, 132), ('Swim', 1500, 2400, 128), ('Swim', 2500, 3900, 126),
]


def build_health(uid):
    hrv, workouts, health_daily = [], [], []
    weight_start, weight_end = 84.0, 78.5
    for day_offset in range(90, -1, -1):
        d = days_ago(day_offset, hour=7)
        frac = 1 - (day_offset / 90.0)
        weight = round(weight_start + (weight_end - weight_start) * frac + random.uniform(-0.4, 0.4), 1)
        sleep_min = random.randint(360, 480)
        hrv.append({'date': d.date().isoformat(), 'value': round(random.uniform(42, 68), 1), 'source': 'healthkit'})
        health_daily.append({
            '_id': f"{uid}_{d.date().isoformat()}", 'date': d.date().isoformat(),
            'healthkitStepsToday': random.randint(4000, 14000), 'healthkitSleepMinutes': sleep_min,
            'healthkitWeightKg': weight, 'proteinTodayG': random.randint(90, 160),
        })
        if random.random() < 0.45:  # ~4x/week training
            wtype, dist, dur, hr = random.choice(WORKOUT_TYPES)
            workouts.append({
                '_id': f'seed-workout-{day_offset:03d}', 'provider': 'strava',
                'stravaActivityId': 900000000 + day_offset, 'type': wtype, 'sportType': wtype,
                'title': f'{wtype} — {"Morning" if d.hour < 12 else "Evening"} session',
                'startDate': ms(d), 'distance_m': dist, 'movingTime_s': dur, 'elapsedTime_s': dur + 120,
                'avgHeartrate': hr + random.randint(-6, 6), 'rpe': random.randint(3, 8),
            })
    return hrv, workouts, health_daily


# ── 7. profiles/{uid} ──────────────────────────────────────────────────────
def build_profile(uid, display_name, email):
    return {
        'ownerUid': uid, 'displayName': display_name, 'email': email,
        'timezone': 'Europe/London', 'currency': 'GBP', 'locationName': 'London, UK',
        'ironmanUmbrellaGoalId': 'seed-goal-ironman', 'fitnessBlocksAutoCreate': True,
        'autoComputeFitnessMetrics': True, 'plannerMode': 'smart',
        'calendarPlannerEnabled': True, 'schedulerEnabled': True,
        'monzoConnected': True, 'monzoAccountId': 'acc_seed0000000001',
        'targetWeightKg': 78, 'targetBodyFatPct': 18, 'targetStepsPerDay': 10000,
        'weeklyWorkoutTargetMinutes': 300, 'isAdmin': False, 'role': 'user',
    }


# ── writer ────────────────────────────────────────────────────────────────
def commit_in_batches(ops, label):
    batch = db.batch()
    count = 0
    total = 0
    for ref_obj, data in ops:
        batch.set(ref_obj, data, merge=True)
        count += 1
        total += 1
        if count >= 400:
            batch.commit()
            batch = db.batch()
            count = 0
    if count > 0:
        batch.commit()
    print(f"  wrote {total} {label}")


def seed_for_uid(uid, display_name, email):
    print(f"Seeding uid={uid} ...")
    goals = build_goals()
    sprints = build_sprints()
    sprint_ids = {SPRINT_ID_KEYS[sp['_id']]: sp['_id'] for sp in sprints}
    stories, tasks = build_stories_and_tasks(goals, sprint_ids)
    theme_alloc = build_theme_allocations()
    txns = build_transactions()
    hrv, workouts, health_daily = build_health(uid)
    profile = build_profile(uid, display_name, email)

    now_ts = firestore.SERVER_TIMESTAMP

    ops = []
    for g in goals:
        gid = g.pop('_id')
        g['ownerUid'] = uid
        g['createdAt'] = now_ts
        g['updatedAt'] = now_ts
        ops.append((db.collection('goals').document(f'{uid}-{gid}'), g))
    commit_in_batches(ops, 'goals')

    ops = []
    for s in stories:
        sid = s.pop('_id')
        s['ownerUid'] = uid
        s['goalId'] = f"{uid}-{s['goalId']}"
        if s.get('sprintId'):
            s['sprintId'] = f"{uid}-{s['sprintId']}"
        s['createdAt'] = now_ts
        s['updatedAt'] = now_ts
        ops.append((db.collection('stories').document(f'{uid}-{sid}'), s))
    commit_in_batches(ops, 'stories')

    ops = []
    for t in tasks:
        tid = t.pop('_id')
        t['ownerUid'] = uid
        if t.get('storyId'):
            t['storyId'] = f"{uid}-{t['storyId']}"
        if t.get('parentId'):
            t['parentId'] = f"{uid}-{t['parentId']}"
        if t.get('sprintId'):
            t['sprintId'] = f"{uid}-{t['sprintId']}"
        created_ms = t.pop('createdAtMs', ms(NOW))
        t['createdAt'] = created_ms
        t['updatedAt'] = ms(NOW)
        ops.append((db.collection('tasks').document(f'{uid}-{tid}'), t))
    commit_in_batches(ops, 'tasks')

    ops = []
    for sp in sprints:
        spid = sp.pop('_id')
        sp['ownerUid'] = uid
        sp['createdAt'] = now_ts
        sp['updatedAt'] = now_ts
        ops.append((db.collection('sprints').document(f'{uid}-{spid}'), sp))
    commit_in_batches(ops, 'sprints')

    db.collection('theme_allocations').document(uid).set(theme_alloc, merge=True)
    print("  wrote theme_allocations")

    ops = []
    for tx in txns:
        txid = tx.pop('_id')
        created_dt = tx.pop('createdAtDt')
        tx['ownerUid'] = uid
        tx['createdAt'] = created_dt
        tx['settledAt'] = created_dt
        tx['updatedAt'] = now_ts
        ops.append((db.collection('monzo_transactions').document(f'{uid}_{txid}'), tx))
    commit_in_batches(ops, 'monzo_transactions')

    ops = []
    for h in hrv:
        h['ownerUid'] = uid
        ops.append((db.collection('metrics_hrv').document(), h))
    commit_in_batches(ops, 'metrics_hrv')

    ops = []
    for w in workouts:
        wid = w.pop('_id')
        w['ownerUid'] = uid
        ops.append((db.collection('metrics_workouts').document(f'{uid}-{wid}'), w))
    commit_in_batches(ops, 'metrics_workouts')

    ops = []
    for hd in health_daily:
        hdid = hd.pop('_id')
        hd['ownerUid'] = uid
        ops.append((db.collection('health_metrics').document(hdid), hd))
    commit_in_batches(ops, 'health_metrics')

    db.collection('profiles').document(uid).set(profile, merge=True)
    print("  wrote profile")


def ensure_auth_user(uid, email, display_name):
    password = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(16))
    try:
        auth.get_user(uid)
        auth.update_user(uid, email=email, display_name=display_name, password=password, email_verified=True)
        print(f"Updated existing auth user {uid} ({email})")
    except auth.UserNotFoundError:
        auth.create_user(uid=uid, email=email, display_name=display_name, password=password, email_verified=True)
        print(f"Created auth user {uid} ({email})")
    return password


if __name__ == '__main__':
    accounts = [
        ('demo-user-jc1-tech', 'demo@jc1.tech', 'Demo User'),
        ('ai-test-user-12345abcdef', 'ai-test-agent@bob.local', 'AI Test Agent'),
    ]
    results = []
    for uid, email, name in accounts:
        pw = ensure_auth_user(uid, email, name)
        seed_for_uid(uid, name, email)
        custom_token = auth.create_custom_token(uid).decode('utf-8')
        results.append((uid, email, pw, custom_token))
        print()

    print("=" * 70)
    for uid, email, pw, token in results:
        print(f"uid: {uid}")
        print(f"email: {email}")
        print(f"password (share only with the human who'll use it): {pw}")
        print(f"custom_token (single sign-in URL param, ~1hr validity):")
        print(f"  https://bob.jc1.tech/?agent_token={token}")
        print("-" * 70)
