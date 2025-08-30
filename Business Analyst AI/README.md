
# BOB App Documentation & Backlog

**Date:** 30 Aug 2025  
**Owner:** Jim (maintained by BA AI)  
**Audience:** Coding AI, Developers, and Contributors

---

## 📖 Overview
This repository is the **single source of truth** for the BOB productivity app.  
It includes requirements, defects, enhancements, schema, tests, design system, mockups, templates, and process guides.

The app vision:  
- **Desktop web:** full Excel-like editing, Pragmatic drag-and-drop Kanban, right-hand context panel, dashboards.  
- **Mobile app:** minimal capture, Daily Priority dashboard, sign out.  
- **Agentic AI integration:** smart scheduling, calendar sync, recovery awareness, daily prioritisation.

---

## 📂 Structure
- `BACKLOG.md` — Index & rollup of all files  
- `gemini.md` — Living requirements (**REQ-xxxx**)  
- `defects.md` — Defects & enhancements (**DEF/ENH-xxxx**)  
- `schema.md` — Canonical data model (Task, Story, Goal, Sprint, etc.)  
- `epics-stories.md` — Agile breakdown (Epics → Stories → Acceptance Criteria)  
- `tests.md` — Test catalogue (**TST-xxxx**)  
- `design.md` — Design system & component guidance  
- `ui-mockups.md` — Wireframes (PNGs + markdown specs)  
- `adrs/` — Architecture Decision Records (e.g., ADR-001 design system)  
- `CHANGELOG.md` — Version history (Conventional Commits)  
- `CONTRIBUTING.md` — Contribution workflow & ID conventions  
- `templates/` — Markdown templates for new stories, defects, enhancements, tests  

---

## 🛠️ Workflow Summary
1. **Start at BACKLOG.md** → find the right file.  
2. Use **templates** when adding new content.  
3. Assign unique IDs (`REQ-0001`, `DEF-0001`, etc.).  
4. Cross-link related items.  
5. Update `CHANGELOG.md` with every change (Conventional Commits format).  
6. Keep mockups in PNG for critical screens; markdown ASCII sketches for others.  

---

## 🚀 Getting Started
- Read `CONTRIBUTING.md` for workflow rules.  
- Check `CHANGELOG.md` for the latest updates.  
- Look at `design.md` for frontend/UI stack decisions.  
- Refer to `schema.md` for entities & fields.  
- Use `tests.md` to guide Selenium/Playwright/AI-based testing.

---

## 📊 Current Critical Screens (see PNGs)
- Tasks Grid + Right Context Panel  
- Story List + Embedded Tasks in RCP  
- Goals List (roll-up)  
- Kanban (Pragmatic DnD + inline edits + list pane)  
- Daily Priority Dashboard (Desktop & Mobile)  
- Task List inline edit example  

---

## 🙌 Notes
This repo is maintained by BA AI. Coding AI should always be pointed back here for the latest canonical requirements and acceptance criteria.  
