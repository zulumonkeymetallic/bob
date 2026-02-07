import React, { useState } from 'react';
import { Modal, Button, Form, Alert, Table, Badge } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, addDoc, serverTimestamp, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { generateRef } from '../utils/referenceGenerator';
import { Upload, Download, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ImportModalProps {
  show: boolean;
  onHide: () => void;
  entityType: 'goals' | 'stories' | 'tasks';
  onImportComplete: () => void;
}

const normalizeHeader = (value: any): string => (
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')
);

const normalizeName = (value: any): string => String(value ?? '').trim().toLowerCase();

const parseAcceptanceCriteria = (value: any): string[] | null => {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const cleaned = value.map((item) => String(item).trim()).filter(Boolean);
    return cleaned.length ? cleaned : null;
  }
  const text = String(value).trim();
  if (!text) return null;
  const parts = text
    .split(/[\n;|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length ? parts : [text];
};

const clampPoints = (value: any): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return Math.min(8, Math.max(1, rounded));
};

const ImportModal: React.FC<ImportModalProps> = ({ show, onHide, entityType, onImportComplete }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const templates = {
    goals: [
      ['ref', 'title', 'description', 'status', 'priority', 'theme', 'confidenceLevel', 'successCriteria'],
      ['GOAL-001', 'Sample Goal', 'This is a sample goal description', 'active', 'high', 'health', 'high', 'Achieve 100% completion']
    ],
    stories: [
      ['story_name', 'goal_name', 'acceptance_criteria', 'points', 'sprint'],
      ['Sample Story', 'Sample Goal', 'Criteria 1; Criteria 2', '3', 'Sprint 1']
    ],
    tasks: [
      ['ref', 'title', 'description', 'status', 'priority', 'storyId', 'dueDate', 'progress'],
      ['TK-001', 'Sample Task', 'This is a sample task description', 'not-started', 'high', 'ST-001', '2024-12-31', '0']
    ]
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError(null);
    setSuccess(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (jsonData.length > 0) {
          setPreview(jsonData.slice(0, 6)); // Show first 5 rows + header
        }
      } catch (err) {
        setError('Error reading file. Please ensure it\'s a valid Excel/CSV file.');
      }
    };
    reader.readAsBinaryString(selectedFile);
  };

  const handleImport = async () => {
    if (!file || !currentUser) return;

    setImporting(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = event.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
          
          if (jsonData.length <= 1) {
            setError('File appears to be empty or contains only headers.');
            setImporting(false);
            return;
          }

          const headers = jsonData[0];
          const normalizedHeaders = headers.map(normalizeHeader);
          const rows = jsonData.slice(1);
          let importedCount = 0;
          const existingRefs: string[] = [];
          const personaValue = currentPersona || 'personal';

          const goalByName = new Map<string, { id: string; theme?: number; ref?: string; title?: string }>();
          const goalByRef = new Map<string, { id: string; theme?: number; ref?: string; title?: string }>();
          const goalById = new Map<string, { id: string; theme?: number; ref?: string; title?: string }>();
          const sprintByName = new Map<string, { id: string; ref?: string; name?: string }>();
          const sprintByRef = new Map<string, { id: string; ref?: string; name?: string }>();
          const sprintById = new Map<string, { id: string; ref?: string; name?: string }>();
          const goalRefs: string[] = [];
          const sprintRefs: string[] = [];

          if (entityType === 'stories') {
            const isPersonaMatch = (value: any) => {
              if (personaValue === 'work') return value === 'work';
              return value == null || value === 'personal';
            };

            const goalsSnap = await getDocs(query(
              collection(db, 'goals'),
              where('ownerUid', '==', currentUser.uid)
            ));
            goalsSnap.docs.forEach((docSnap) => {
              const data = docSnap.data() as any;
              if (!isPersonaMatch(data.persona)) return;
              const record = {
                id: docSnap.id,
                theme: data.theme,
                ref: data.ref,
                title: data.title,
              };
              const nameKey = normalizeName(data.title);
              if (nameKey) goalByName.set(nameKey, record);
              if (data.ref) goalByRef.set(normalizeName(data.ref), record);
              goalById.set(normalizeName(docSnap.id), record);
              if (data.ref) goalRefs.push(data.ref);
            });

            const sprintsSnap = await getDocs(query(
              collection(db, 'sprints'),
              where('ownerUid', '==', currentUser.uid)
            ));
            sprintsSnap.docs.forEach((docSnap) => {
              const data = docSnap.data() as any;
              if (!isPersonaMatch(data.persona)) return;
              const record = {
                id: docSnap.id,
                ref: data.ref,
                name: data.name,
              };
              const nameKey = normalizeName(data.name);
              if (nameKey) sprintByName.set(nameKey, record);
              if (data.ref) sprintByRef.set(normalizeName(data.ref), record);
              sprintById.set(normalizeName(docSnap.id), record);
              if (data.ref) sprintRefs.push(data.ref);
            });
          }

          for (const row of rows) {
            if (!row || row.length === 0) continue;

            const entity: any = {
              ownerUid: currentUser.uid,
              persona: personaValue,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            };
            let goalNameValue: string | null = null;
            let sprintNameValue: string | null = null;
            let acceptanceCriteriaValue: string[] | null = null;

            // Map row data to entity fields
            normalizedHeaders.forEach((headerKey: string, index: number) => {
              const value = row[index];
              if (value !== undefined && value !== '') {
                switch (headerKey) {
                  case 'ref':
                    entity.ref = String(value).trim();
                    break;
                  case 'story_name':
                  case 'name':
                  case 'title':
                    entity.title = value;
                    break;
                  case 'description':
                    entity.description = value;
                    break;
                  case 'status':
                    entity.status = getStatusValue(value);
                    break;
                  case 'priority':
                    entity.priority = getPriorityValue(value);
                    break;
                  case 'theme':
                    entity.theme = value;
                    break;
                  case 'goalid':
                  case 'goal_id':
                    entity.goalId = value;
                    break;
                  case 'goal_name':
                  case 'linked_goal_name':
                  case 'goal':
                    goalNameValue = String(value).trim();
                    break;
                  case 'storyid':
                  case 'story_id':
                    entity.storyId = value;
                    break;
                  case 'sprintid':
                  case 'sprint_id':
                    entity.sprintId = value;
                    break;
                  case 'sprint':
                  case 'sprint_name':
                    sprintNameValue = String(value).trim();
                    break;
                  case 'points': {
                    const points = clampPoints(value);
                    if (points != null) entity.points = points;
                    break;
                  }
                  case 'progress':
                    entity.progress = parseInt(value) || 0;
                    break;
                  case 'duedate':
                  case 'due_date':
                    entity.dueDate = new Date(value);
                    break;
                  case 'confidencelevel':
                  case 'confidence_level':
                    entity.confidenceLevel = value;
                    break;
                  case 'successcriteria':
                  case 'success_criteria':
                    entity.successCriteria = value;
                    break;
                  case 'acceptancecriteria':
                  case 'acceptance_criteria':
                    acceptanceCriteriaValue = parseAcceptanceCriteria(value);
                    break;
                  default:
                    entity[headerKey] = value;
                }
              }
            });

            if (entityType === 'stories') {
              const resolveGoalByName = async (rawName: string) => {
                const key = normalizeName(rawName);
                if (!key) return null;
                const existing = goalByName.get(key) || goalByRef.get(key) || goalById.get(key);
                if (existing) return existing;
                const now = Date.now();
                const ref = generateRef('goal', goalRefs);
                goalRefs.push(ref);
                const goalData = {
                  ref,
                  title: rawName.trim(),
                  description: '',
                  theme: 2,
                  size: 2,
                  timeToMasterHours: 40,
                  confidence: 0.5,
                  startDate: now,
                  endDate: now + 30 * 24 * 60 * 60 * 1000,
                  status: 0,
                  priority: 2,
                  persona: personaValue,
                  ownerUid: currentUser.uid,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                };
                const docRef = await addDoc(collection(db, 'goals'), goalData);
                const record = { id: docRef.id, theme: goalData.theme, ref: goalData.ref, title: goalData.title };
                goalByName.set(key, record);
                goalByRef.set(normalizeName(ref), record);
                goalById.set(normalizeName(docRef.id), record);
                return record;
              };

              const resolveSprintByName = async (rawName: string) => {
                const key = normalizeName(rawName);
                if (!key) return null;
                const existing = sprintByName.get(key) || sprintByRef.get(key) || sprintById.get(key);
                if (existing) return existing;
                const now = Date.now();
                const ref = generateRef('sprint', sprintRefs);
                sprintRefs.push(ref);
                const sprintData = {
                  ref,
                  name: rawName.trim(),
                  objective: '',
                  notes: '',
                  startDate: now,
                  endDate: now + 14 * 24 * 60 * 60 * 1000,
                  planningDate: now,
                  retroDate: now + 14 * 24 * 60 * 60 * 1000,
                  status: 0,
                  ownerUid: currentUser.uid,
                  persona: personaValue,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                };
                const docRef = await addDoc(collection(db, 'sprints'), sprintData);
                const record = { id: docRef.id, ref: sprintData.ref, name: sprintData.name };
                sprintByName.set(key, record);
                sprintByRef.set(normalizeName(ref), record);
                sprintById.set(normalizeName(docRef.id), record);
                return record;
              };

              if (!entity.goalId && goalNameValue) {
                const resolvedGoal = await resolveGoalByName(goalNameValue);
                if (resolvedGoal?.id) {
                  entity.goalId = resolvedGoal.id;
                  if (resolvedGoal.theme != null) entity.theme = resolvedGoal.theme;
                }
              } else if (entity.goalId) {
                const resolved = goalById.get(normalizeName(entity.goalId)) || goalByRef.get(normalizeName(entity.goalId));
                if (resolved?.theme != null) entity.theme = resolved.theme;
              }

              if (!entity.sprintId && sprintNameValue) {
                const resolvedSprint = await resolveSprintByName(sprintNameValue);
                if (resolvedSprint?.id) entity.sprintId = resolvedSprint.id;
              }

              if (acceptanceCriteriaValue) {
                entity.acceptanceCriteria = acceptanceCriteriaValue;
              }

              if (!entity.points) {
                entity.points = 1;
              }

              if (entity.priority == null) entity.priority = 2;
              if (entity.status == null) entity.status = 0;
              if (!entity.orderIndex) entity.orderIndex = Date.now() + importedCount;
              if (!entity.wipLimit) entity.wipLimit = 10;
            }

            // Generate reference if not provided
            if (!entity.ref) {
              const typeMap = { goals: 'goal', stories: 'story', tasks: 'task' };
              entity.ref = generateRef(typeMap[entityType] as any, existingRefs);
              existingRefs.push(entity.ref);
            }

            // Set defaults
            if (entity.status == null) entity.status = 0;
            if (entity.priority == null) entity.priority = 0;

            await addDoc(collection(db, entityType), entity);
            importedCount++;
          }

          setSuccess(`Successfully imported ${importedCount} ${entityType}.`);
          onImportComplete();
          
          // Auto-close after 2 seconds
          setTimeout(() => {
            onHide();
          }, 2000);

        } catch (err) {
          console.error('Import error:', err);
          setError('Error importing data. Please check the file format.');
        }
        setImporting(false);
      };
      reader.readAsBinaryString(file);
    } catch (err) {
      setError('Error processing file.');
      setImporting(false);
    }
  };

  const getStatusValue = (status: string): number => {
    const statusMap: { [key: string]: number } = {
      'not-started': 0, 'backlog': 0, 'inactive': 0,
      'active': 1, 'planned': 1, 'in-progress': 1,
      'blocked': 2, 'testing': 2, 'review': 2,
      'done': 3, 'complete': 3, 'completed': 3
    };
    return statusMap[status.toLowerCase()] || 0;
  };

  const getPriorityValue = (priority: string): number => {
    const priorityMap: { [key: string]: number } = {
      'none': 0, 'low': 1, 'medium': 2, 'high': 3
    };
    return priorityMap[priority.toLowerCase()] || 0;
  };

  const downloadTemplate = () => {
    const template = templates[entityType];
    const ws = XLSX.utils.aoa_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, entityType);
    XLSX.writeFile(wb, `${entityType}_template.xlsx`);
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Import {entityType.charAt(0).toUpperCase() + entityType.slice(1)}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <div className="mb-3">
          <Button variant="outline-info" onClick={downloadTemplate} className="mb-3">
            <Download size={16} className="me-2" />
            Download Template
          </Button>
          <Form.Text className="d-block">
            Download the Excel template to see the required format and column headers.
          </Form.Text>
        </div>

        <Form.Group className="mb-3">
          <Form.Label>Select Excel/CSV File</Form.Label>
          <Form.Control
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
          />
          <Form.Text>
            Supported formats: Excel (.xlsx, .xls) and CSV files
          </Form.Text>
        </Form.Group>

        {preview.length > 0 && (
          <div className="mb-3">
            <h6>Preview (first 5 rows):</h6>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <Table size="sm" striped>
                <thead>
                  <tr>
                    {preview[0]?.map((header, index) => (
                      <th key={index}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(1).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} style={{ fontSize: '0.8rem' }}>
                          {cell?.toString() || ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button 
          variant="primary" 
          onClick={handleImport}
          disabled={!file || importing}
        >
          {importing ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Importing...
            </>
          ) : (
            <>
              <Upload size={16} className="me-2" />
              Import
            </>
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ImportModal;
