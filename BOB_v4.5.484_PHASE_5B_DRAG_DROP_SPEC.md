# Phase 5B: Drag-and-Drop Goal Pinning to Map — Implementation Plan

**Status:** IN PROGRESS  
**Estimated Duration:** 12-16 hours  
**Date Started:** March 12, 2026  
**Build Base:** v4.5.484

---

## Overview

Phase 5B enables users to drag travel goal cards directly onto the map to create travel entries. This provides a rich, visual way to plan travel by:
- Dragging goals from a sidebar list onto the map
- Auto-creating travel entries for dropped goals
- Establishing bidirectional linking (goal ↔ travel entry)
- Visual drop zones and drag feedback

---

## Feature Specification

### 1. Draggable Goals Panel
**Location:** Left sidebar or collapsible panel in TravelMap  
**Content:** List of all travel goals (theme ID = 7 or 'travel' tag)  
**Behavior:**
- Shows 10-15 goals by default, with scroll/pagination
- Drag handle on each goal card
- Goal title, theme badge, linked entry count
- Color-coded by theme

### 2. Drag-and-Drop Integration
**Library:** @dnd-kit/core (already in use across project)  
**Draggable Setup:**
- `DndContext` wraps TravelMap component
- `useDraggable` on goal cards
- Goal ID as drag identifier

**Droppable Setup:**
- `useDroppable` on map container
- Drop zone ID: `map-drop-zone`
- Visual feedback: Highlight on hover, green glow on valid drop

### 3. Drop Handling
**On Drop:**
1. Get dropped goal ID from drag event
2. Get drop coordinates from event (map pixel coords)
3. **Reverse geocode** map coordinates → country/city
4. Create travel entry linked to goal
5. Auto-set status based on goal properties

**Reverse Geocoding:**
- Use `geocodePlace()` with reversed coords (Nominatim API)
- Fallback: Get country from map feature at coordinates
- If city level available, set city; else country only

### 4. Visual Feedback
**During Drag:**
- Goal card opacity: 0.6
- Map container: Green border (#10b981)
- Crosshair cursor over map
- "Drop to create travel entry" tooltip

**On Drop Success:**
- Toast/quick notification: "Created travel entry for [Goal Name]"
- Map marker appears instantly
- Selected country highlights in map

**Drop Feedback:**
- Invalid drops (outside map bounds): Red highlight, "Drop on map to create travel entry"
- Valid drops: Green highlight

### 5. Keyboard-Only Alt Mode
**For Accessibility:**
- Alt+D: Open goal picker modal
- Select goal + enter target country/city
- Creates same travel entry without drag

---

## Code Implementation Strategy

### Files to Modify

#### 1. **TravelMap.tsx** (Primary changes)

Add to imports:
```typescript
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  useDroppable,
  useDraggable,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
```

Add state:
```typescript
const [isDraggingOverMap, setIsDraggingOverMap] = useState(false);
const [dragOverCoords, setDragOverCoords] = useState<[number, number] | null>(null);
const [goalListExpanded, setGoalListExpanded] = useState(true);
const [droppedGoalLastId, setDroppedGoalLastId] = useState<string | null>(null);
```

Add ref for map coordinates:
```typescript
const mapDropZoneRef = useRef<HTMLDivElement | null>(null);
```

Add handlers:
- `handleDragOver(event)` — Captures map coordinates during drag
- `handleDragEnd(event)` — Processes drop, creates travel entry
- `reverseGeocodeCoordinates(lngLat)` — Gets country/city from map coords
- `createTravelEntryFromGoal(goal, coords)` — Creates linked entry

Add sensors:
```typescript
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
);
```

Wrap  map in DndContext:
```typescript
<DndContext sensors={sensors} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
  {/* ... existing map code ... */}
  <div ref={mapDropZoneRef} /* map container */>
    {isDraggingOverMap && <DropZoneOverlay />}
  </div>
</DndContext>
```

#### 2. **New Component: DraggableGoalCard.tsx**

Render individual goal cards with:
- `useDraggable` hook
- Goal title, theme badge, entry count
- Drag handle icon (⋮⋮)
- Visual feedback during drag

#### 3. **New Component: GoalListPanel.tsx**

Sidebar/panel with:
- Expandable goal list
- Scroll area (max-height 400px)
- Toggle button
- "Show All Goals" / "Travel Goals Only" filter toggle

---

## Implementation Phases

### Phase 5B-1: DnD Context Setup (2-3 hours)
- [x] Add @dnd-kit imports to TravelMap
- [ ] Add sensors and DndContext wrapper
- [ ] Create DraggableGoalCard component with useDraggable
- [ ] Create GoalListPanel component
- [ ] Add state for drag feedback

### Phase 5B-2: Drop Zone & Event Handlers (3-4 hours)
- [ ] Add useDroppable to map container
- [ ] Implement `handleDragOver()` — capture coordinates
- [ ] Implement `handleDragEnd()` — process drop
- [ ] Add visual feedback (drag over state)
- [ ] Test drag-drop event flow

### Phase 5B-3: Reverse Geocoding & Entry Creation (4-5 hours)
- [ ] Implement `reverseGeocodeCoordinates()` — Nominatim API call
- [ ] Implement fallback: Get country from GeoJSON feature
- [ ] Implement `createTravelEntryFromGoal()` — linked entry creation
- [ ] Auto-set status: BUCKET_LIST for bucket list goals
- [ ] Auto-link story if goal has linked story

### Phase 5B-4: UX Polish & Accessibility (2-3 hours)
- [ ] Drop zone visual overlay (green highlight)
- [ ] Toast notifications (created/failed)
- [ ] Drag ghost/opacity feedback
- [ ] Keyboard mode (Alt+D picker)
- [ ] Tooltip for drag instructions
- [ ] Error handling (invalid drops, API failures)

### Phase 5B-5: Testing & Refinement (1-2 hours)
- [ ] E2E test: Drag goal onto map → entry created
- [ ] Test reverse geocoding edge cases
- [ ] Test with 10+ goals in list
- [ ] Performance: Drag with large goal list
- [ ] Mobile/touch support (if applicable)

---

## Data Model

### Travel Entry Created from Drop
```typescript
interface TravelEntryFromDrop {
  placeType: 'country' | 'city';
  name: string; // Country or city name
  countryCode: string; // ISO alpha-2
  city?: string; // If city-level geocode
  status: 'BUCKET_LIST'; // Can be customized
  goalId: goal.id; // Linked goal
  goalTitleSnapshot: goal.title;
  locationName?: string; // Geocoded display name
  lat?: number; // From geocode result
  lon?: number; // From geocode result
  continent: string; // Detected from country
  ownerUid: currentUser.uid;
  createdAt: serverTimestamp();
  updatedAt: serverTimestamp();
  plannedVisitAt?: number; // From goal.endDate if available
  matchMethod: 'drag'; // Marker for drag-created entries
}
```

### Drop Event Payload
```typescript
interface MapDropEvent {
  goalId: string;
  mapCoords: { lng: number; lat: number };
  country?: string;
  city?: string;
  countryCode?: string;
}
```

---

## API Integration

### Reverse Geocoding (Nominatim)
**Endpoint:** `https://nominatim.openstreetmap.org/reverse`  
**Method:** GET  
**Query:**
```
lat={lat}&lon={lon}&format=json&zoom=10
```

**Response:**
```json
{
  "address": {
    "city": "Paris",
    "country": "France",
    "country_code": "fr"
  },
  "display_name": "Paris, France"
}
```

**Fallback (Map Feature Lookup):**
- Query GeoJSON features at drop coordinates
- Extract `iso2` from matched country feature
- No external API call needed

---

## Visual Design

### Drag Visual State
| State | Style |
|-------|-------|
| Dragging Over Map | Green border (#10b981), 3px |
| Valid Drop Zone | Green glow (box-shadow), cursor: copy |
| Invalid Drop | Red border (#ef4444), cursor: not-allowed |
| Dropped | Flash animation, toast notification |

### Goal List Panel
- **Position:** Left sidebar (collapsible)
- **Width:** 280px (collapsed: 40px)
- **Background:** #f8fafc
- **Border:** 1px solid #e5e7eb
- **Max-Height Content:** 400px with scroll
- **Cards:** minimal (title, theme badge, drag handle)

### Drop Overlay
- **Color:** rgba(16, 185, 129, 0.2)
- **Border:** 2px dashed #10b981
- **Text:** "Drop to create travel entry"
- **Font Size:** 12px, #10b981, opacity 0.7
- **Position:** Absolute, covers entire map

---

## Error Handling

| Error | Message | Recovery |
|-------|---------|----------|
| Drop outside map | "Invalid drop location" | Disable drop styling |
| Reverse geocode fails | "Could not identify location" | Use map feature fallback |
| Goal already linked | (Optional) Skip if limit reached | Show count of existing entries |
| Entry creation fails | "Failed to create travel entry" | Retry with same goal |
| Network timeout | "Geocoding took too long" | Fallback to map feature only |

---

## Testing Checklist

### Unit
- [ ] `handleDragEnd()` extracts correct goal/coords
- [ ] `reverseGeocodeCoordinates()` returns country/city or null
- [ ] `createTravelEntryFromGoal()` creates doc with correct fields
- [ ] Drop outside map bounds rejected
- [ ] Duplicate entry protection works

### Integration
- [ ] Goal card draggable, marker shows during drag
- [ ] Drop on map triggers entry creation
- [ ] Map marker appears instantly after drop
- [ ] Goal list scrolls without triggering drag
- [ ] Multiple drops work in sequence

### E2E
- [ ] Drag France goal → drop on Germany → entry created for Germany (NOT France)
- [ ] Drag city-level goal → drop on city area → entry captures city + country
- [ ] Drop creates travel entry linked to goal
- [ ] Toast shows success message
- [ ] Entry appears in travel list immediately

### Performance
- [ ] 50 goals in list: Drag responsiveness <100ms of input lag
- [ ] Reverse geocode: <1s for typical response
- [ ] Entry creation Firestore write: <500ms
- [ ] Map rerender: No jank after drop

---

## Dependencies

Already Available:
- ✅ @dnd-kit/core (used in SprintPlannerMatrix, ModernGoalsTable)
- ✅ @dnd-kit/utilities (CSS helper)
- ✅ maplibregl (from existing TravelMap)
- ✅ geocodePlace() utility (reverse version needed)

New Dependencies: None required

---

## Done Criteria

Phase 5B is complete when:
1. ✅ User can drag goal from sidebar onto map
2. ✅ Drop creates travel entry linked to that goal
3. ✅ Visual feedback during drag/drop
4. ✅ Reverse geocoding identifies country/city at drop location
5. ✅ Toast confirms successful entry creation
6. ✅ Keyboard alt mode (goal picker) available
7. ✅ Build passes: `npm run build` with no errors
8. ✅ No breaking changes to existing features
9. ✅ E2E tests pass: Drag → drop → entry visible + linked

---

## Next Steps After 5B

**Phase 4:** Hierarchical Navigation with Breadcrumbs (~16–20 hours)
- Continental regions grouping
- Breadcrumb trail for quick navigation
- Region-level aggregation stats

---

**Document Version:** 1.0  
**Created:** March 12, 2026  
**Status:** Ready for implementation
