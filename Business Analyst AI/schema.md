
# schema.md — Data Model

**Date:** 30 Aug 2025

## Task
Fields: id, title, status, priority, due_date, assignee, story_id, sprint_id, estimate, tags, description.  
Meta: created_by, created_at, updated_by, updated_at.  
Relations: notes[], audit[].  
**History:** Inline editing of all these fields was insisted on by Jim. Audit added to support context/history panel.

## Story
Fields: id, title, status, priority, sprint_id, goal_id, estimate, assignee.  
Relations: tasks[].  
**History:** Needed to support goal roll-up and sprint planning.

## Goal
Fields: id, title, theme, status, target_date, owner.  
Relations: stories[].  
**History:** Themes and goals linked to visual canvas and travel/reading goals.

## Sprint
Fields: id, name, start_date, end_date, burndown_metrics.  
**History:** Added to support Gantt chart and sprint dropdown.

## Note
Fields: id, entity_type, entity_id, text, author, created_at.  
**History:** Added after Jim wanted “add note” from list and RCP.

## AuditEvent
Fields: id, entity_type, entity_id, field, old_value, new_value, user, timestamp, source.  
**History:** Based on ServiceNow-style audit log pattern.
