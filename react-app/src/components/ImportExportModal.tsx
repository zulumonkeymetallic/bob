import React, { useState } from 'react';
import { Modal, Button, Tabs, Tab, Form, Alert, Badge } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, addDoc, doc, setDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';

interface ImportExportModalProps {
  show: boolean;
  onHide: () => void;
}

const GOAL_TEMPLATES = {
  health: {
    title: "Complete Marathon Training",
    description: "Train for and complete a marathon within 6 months",
    theme: "Health",
    size: "L",
    timeToMasterHours: 180,
    confidence: 0.7,
    kpis: [
      { name: "Weekly running distance", target: 50, unit: "km" },
      { name: "Long run distance", target: 35, unit: "km" }
    ]
  },
  wealth: {
    title: "Build Emergency Fund",
    description: "Save 6 months of expenses in emergency fund",
    theme: "Wealth", 
    size: "M",
    timeToMasterHours: 60,
    confidence: 0.8,
    kpis: [
      { name: "Emergency fund amount", target: 25000, unit: "USD" },
      { name: "Monthly savings rate", target: 20, unit: "%" }
    ]
  },
  growth: {
    title: "Learn React Native Development",
    description: "Master React Native and build a mobile app",
    theme: "Growth",
    size: "L", 
    timeToMasterHours: 120,
    confidence: 0.6,
    kpis: [
      { name: "Completed courses", target: 3, unit: "courses" },
      { name: "Apps built", target: 2, unit: "apps" }
    ]
  },
  tribe: {
    title: "Strengthen Family Relationships",
    description: "Spend more quality time with family members",
    theme: "Tribe",
    size: "M",
    timeToMasterHours: 80,
    confidence: 0.9,
    kpis: [
      { name: "Family dinners per month", target: 12, unit: "dinners" },
      { name: "Quality time hours per week", target: 10, unit: "hours" }
    ]
  },
  home: {
    title: "Organize and Declutter Home",
    description: "Complete home organization and create peaceful living space",
    theme: "Home",
    size: "M",
    timeToMasterHours: 40,
    confidence: 0.8,
    kpis: [
      { name: "Rooms organized", target: 6, unit: "rooms" },
      { name: "Items donated", target: 100, unit: "items" }
    ]
  }
};

const STORY_TEMPLATES = {
  health: [
    {
      title: "Create weekly training schedule",
      priority: "P1",
      points: 3,
      acceptanceCriteria: [
        "Schedule includes 4 running days per week",
        "Rest days are properly planned",
        "Progressive distance increase each week"
      ]
    },
    {
      title: "Purchase running gear and equipment", 
      priority: "P2",
      points: 2,
      acceptanceCriteria: [
        "Running shoes selected and purchased",
        "Weather-appropriate clothing acquired",
        "Hydration and nutrition supplies ready"
      ]
    }
  ],
  wealth: [
    {
      title: "Calculate emergency fund target amount",
      priority: "P1", 
      points: 2,
      acceptanceCriteria: [
        "Monthly expenses calculated accurately",
        "6-month target amount determined",
        "Savings plan created"
      ]
    },
    {
      title: "Open high-yield savings account",
      priority: "P1",
      points: 1,
      acceptanceCriteria: [
        "Research and compare savings accounts",
        "Account opened with best rate",
        "Automatic transfer set up"
      ]
    }
  ],
  growth: [
    {
      title: "Complete React Native fundamentals course",
      priority: "P1",
      points: 5,
      acceptanceCriteria: [
        "Course 100% completed with exercises",
        "Basic app built following tutorial",
        "Notes and reference materials organized"
      ]
    }
  ],
  tribe: [
    {
      title: "Plan monthly family activities",
      priority: "P1",
      points: 3,
      acceptanceCriteria: [
        "Monthly activity calendar created",
        "Family input gathered for preferences",
        "Activities scheduled and booked"
      ]
    }
  ],
  home: [
    {
      title: "Declutter and organize bedroom",
      priority: "P1",
      points: 3,
      acceptanceCriteria: [
        "All items sorted: keep, donate, discard",
        "Storage solutions implemented",
        "Room cleaned and organized"
      ]
    }
  ]
};

const TASK_TEMPLATES = {
  health: [
    { title: "30-minute morning run", effort: "M", estimateMin: 30, description: "Easy pace morning run for base building" },
    { title: "Strength training - legs", effort: "M", estimateMin: 45, description: "Leg workout for running strength" },
    { title: "Plan weekly meals", effort: "S", estimateMin: 20, description: "Healthy meal planning for training" }
  ],
  wealth: [
    { title: "Review monthly budget", effort: "M", estimateMin: 60, description: "Analyze spending and adjust budget" },
    { title: "Research investment options", effort: "L", estimateMin: 90, description: "Research and compare investment accounts" },
    { title: "Track daily expenses", effort: "S", estimateMin: 10, description: "Log daily spending in tracking app" }
  ],
  growth: [
    { title: "Complete React Native lesson", effort: "M", estimateMin: 60, description: "Work through course materials and exercises" },
    { title: "Build practice component", effort: "L", estimateMin: 120, description: "Create component from scratch for practice" },
    { title: "Read development articles", effort: "S", estimateMin: 30, description: "Stay updated with latest development trends" }
  ],
  tribe: [
    { title: "Call family member", effort: "S", estimateMin: 30, description: "Weekly check-in call with family" },
    { title: "Plan weekend family activity", effort: "M", estimateMin: 45, description: "Research and plan family outing" },
    { title: "Send thank you message", effort: "S", estimateMin: 15, description: "Express gratitude to someone important" }
  ],
  home: [
    { title: "Declutter one drawer", effort: "S", estimateMin: 30, description: "Sort and organize single drawer completely" },
    { title: "Deep clean one room", effort: "M", estimateMin: 60, description: "Thorough cleaning of selected room" },
    { title: "Organize digital photos", effort: "L", estimateMin: 90, description: "Sort and organize digital photo collection" }
  ]
};

const ImportExportModal: React.FC<ImportExportModalProps> = ({ show, onHide }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [activeTab, setActiveTab] = useState('templates');
  const [importData, setImportData] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const generateCSVTemplate = (type: 'goals' | 'stories' | 'tasks') => {
    switch (type) {
      case 'goals':
        return `title,description,theme,size,timeToMasterHours,confidence,targetDate,kpi1Name,kpi1Target,kpi1Unit,kpi2Name,kpi2Target,kpi2Unit
"Complete Marathon Training","Train for and complete a marathon","Health","L",180,0.7,"2025-12-31","Weekly distance","50","km","Long run distance","35","km"
"Build Emergency Fund","Save 6 months expenses","Wealth","M",60,0.8,"2025-10-31","Fund amount","25000","USD","Savings rate","20","%"`;
      
      case 'stories':
        return `title,goalTitle,priority,points,status,acceptanceCriteria1,acceptanceCriteria2,acceptanceCriteria3
"Create training schedule","Complete Marathon Training","P1",3,"backlog","Schedule includes 4 running days","Rest days planned","Progressive distance increase"
"Purchase running gear","Complete Marathon Training","P2",2,"backlog","Running shoes purchased","Weather gear acquired","Nutrition supplies ready"`;
      
      case 'tasks':
        return `title,parentTitle,parentType,effort,priority,estimateMin,description,theme,dueDate,status
"30-minute morning run","Create training schedule","story","M","high",30,"Easy pace base building run","Health","2025-09-01","planned"
"Research running shoes","Purchase running gear","story","S","med",45,"Compare and select proper running shoes","Health","2025-08-31","planned"`;
    }
  };

  const downloadTemplate = (type: 'goals' | 'stories' | 'tasks') => {
    const csv = generateCSVTemplate(type);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${type}_template.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const importFromTemplate = async (category: keyof typeof GOAL_TEMPLATES) => {
    if (!currentUser) return;
    
    setIsImporting(true);
    try {
      // Import goal
      const goalTemplate = GOAL_TEMPLATES[category];
      const goalRef = await addDoc(collection(db, 'goals'), {
        ...goalTemplate,
        persona: currentPersona,
        ownerUid: currentUser.uid,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Import stories
      const storyTemplates = STORY_TEMPLATES[category] || [];
      const storyRefs = [];
      for (const storyTemplate of storyTemplates) {
        const storyRef = await addDoc(collection(db, 'stories'), {
          ...storyTemplate,
          goalId: goalRef.id,
          persona: currentPersona,
          ownerUid: currentUser.uid,
          status: 'backlog',
          orderIndex: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        storyRefs.push(storyRef);
      }

      // Import tasks
      const taskTemplates = TASK_TEMPLATES[category] || [];
      for (let i = 0; i < taskTemplates.length && i < storyRefs.length; i++) {
        await addDoc(collection(db, 'tasks'), {
          ...taskTemplates[i],
          parentType: 'story',
          parentId: storyRefs[i].id,
          persona: currentPersona,
          ownerUid: currentUser.uid,
          status: 'planned',
          priority: 'med',
          theme: goalTemplate.theme,
          hasGoal: true,
          alignedToGoal: true,
          source: 'template',
          syncState: 'clean',
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      setImportResult(`✅ Successfully imported ${category} template with ${storyTemplates.length} stories and ${taskTemplates.length} tasks!`);
    } catch (error) {
      console.error('Import error:', error);
      setImportResult(`❌ Import failed: ${error.message}`);
    }
    setIsImporting(false);
  };

  const parseCSVImport = async () => {
    if (!currentUser || !importData.trim()) return;

    setIsImporting(true);
    try {
      const lines = importData.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
      const rows = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.replace(/"/g, '').trim());
        const obj: any = {};
        headers.forEach((header, index) => {
          obj[header] = values[index] || '';
        });
        return obj;
      });

      let imported = 0;
      for (const row of rows) {
        if (row.title) {
          await addDoc(collection(db, 'goals'), {
            title: row.title,
            description: row.description || '',
            theme: row.theme || 'Growth',
            size: row.size || 'M',
            timeToMasterHours: parseInt(row.timeToMasterHours) || 40,
            confidence: parseFloat(row.confidence) || 0.5,
            targetDate: row.targetDate ? new Date(row.targetDate) : null,
            kpis: [
              { name: row.kpi1Name || '', target: parseInt(row.kpi1Target) || 0, unit: row.kpi1Unit || '' }
            ].filter(kpi => kpi.name),
            persona: currentPersona,
            ownerUid: currentUser.uid,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date()
          });
          imported++;
        }
      }

      setImportResult(`✅ Successfully imported ${imported} items!`);
    } catch (error) {
      console.error('CSV import error:', error);
      setImportResult(`❌ Import failed: ${error.message}`);
    }
    setIsImporting(false);
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" className="import-export-modal">
      <Modal.Header closeButton>
        <Modal.Title>Import & Export</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Tabs activeKey={activeTab} onSelect={(k) => setActiveTab(k || 'templates')}>
          <Tab eventKey="templates" title="Quick Start Templates">
            <div className="p-3">
              <p className="mb-4">Choose a template to quickly set up a complete goal with stories and tasks:</p>
              
              <div className="row">
                {Object.entries(GOAL_TEMPLATES).map(([key, template]) => (
                  <div key={key} className="col-md-6 mb-3">
                    <div className="md-card">
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <h6 className="mb-1">{template.title}</h6>
                        <Badge className={`md-chip ${key}`}>{template.theme}</Badge>
                      </div>
                      <p className="md-body-2 text-muted mb-3">{template.description}</p>
                      <div className="d-flex justify-content-between align-items-center">
                        <small className="text-muted">{template.timeToMasterHours}h • {template.size} size</small>
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={() => importFromTemplate(key as keyof typeof GOAL_TEMPLATES)}
                          disabled={isImporting}
                        >
                          Use Template
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Tab>

          <Tab eventKey="csv" title="CSV Import">
            <div className="p-3">
              <h6>Import from CSV</h6>
              <p>Paste CSV data or upload a file with your goals, stories, or tasks.</p>
              
              <div className="mb-3">
                <h6>Download Templates:</h6>
                <div className="btn-group mb-3">
                  <Button variant="outline-secondary" onClick={() => downloadTemplate('goals')}>
                    Goals Template
                  </Button>
                  <Button variant="outline-secondary" onClick={() => downloadTemplate('stories')}>
                    Stories Template  
                  </Button>
                  <Button variant="outline-secondary" onClick={() => downloadTemplate('tasks')}>
                    Tasks Template
                  </Button>
                </div>
              </div>

              <Form.Group className="mb-3">
                <Form.Label>CSV Data</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={8}
                  value={importData}
                  onChange={(e) => setImportData(e.target.value)}
                  placeholder="Paste your CSV data here..."
                />
              </Form.Group>

              <Button
                variant="primary"
                onClick={parseCSVImport}
                disabled={isImporting || !importData.trim()}
              >
                {isImporting ? 'Importing...' : 'Import CSV'}
              </Button>
            </div>
          </Tab>

          <Tab eventKey="export" title="Export Data">
            <div className="p-3">
              <h6>Export Your Data</h6>
              <p>Download your goals, stories, and tasks as CSV files for backup or analysis.</p>
              
              <div className="d-grid gap-2">
                <Button variant="outline-primary">Export Goals</Button>
                <Button variant="outline-primary">Export Stories</Button>
                <Button variant="outline-primary">Export Tasks</Button>
                <Button variant="outline-success">Export All Data</Button>
              </div>
            </div>
          </Tab>
        </Tabs>

        {importResult && (
          <Alert variant={importResult.includes('✅') ? 'success' : 'danger'} className="mt-3">
            {importResult}
          </Alert>
        )}
      </Modal.Body>
    </Modal>
  );
};

export default ImportExportModal;

export {};
