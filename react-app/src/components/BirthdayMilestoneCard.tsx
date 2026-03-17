import React, { useMemo, useState, useEffect } from 'react';
import { Card, Button, Modal, Form } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { Cake, Target, X } from 'lucide-react';
import { saveFocusWizardPrefill } from '../services/focusGoalsService';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../firebase';
import { generateRef } from '../utils/referenceGenerator';

interface BirthdayMilestoneCardProps {
  targetDate: Date; // Sept 22, 2027
  age: number; // 45
  linkedGoalsCount?: number;
}

const BIRTHDAY_BANNER_DISMISS_KEY = 'birthday-banner-dismissed-date';
const SHOW_EVERY_DAYS = 3;

const BirthdayMilestoneCard: React.FC<BirthdayMilestoneCardProps> = ({
  targetDate,
  age,
  linkedGoalsCount = 0
}) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [showBanner, setShowBanner] = useState(true);
  const [showPlannerModal, setShowPlannerModal] = useState(false);
  const [programName, setProgramName] = useState(`Project ${age} v2`);
  const [programEndDate, setProgramEndDate] = useState(targetDate.toISOString().slice(0, 10));
  const [milestoneTitlesText, setMilestoneTitlesText] = useState('Build base fitness\nCut body fat\nPeak for birthday');
  const [launchingFocusFlow, setLaunchingFocusFlow] = useState(false);

  // Check if we should show the banner (only every 3 days)
  useEffect(() => {
    const dismissedDate = localStorage.getItem(BIRTHDAY_BANNER_DISMISS_KEY);
    if (dismissedDate) {
      const lastDismissed = new Date(dismissedDate);
      const now = new Date();
      const daysSinceDismiss = Math.floor((now.getTime() - lastDismissed.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceDismiss < SHOW_EVERY_DAYS) {
        setShowBanner(false);
        return;
      }
    }
    setShowBanner(true);
  }, []);

  const handleDismissBanner = () => {
    localStorage.setItem(BIRTHDAY_BANNER_DISMISS_KEY, new Date().toISOString());
    setShowBanner(false);
  };

  const handleOpenPlanner = () => {
    setProgramName((current) => current || `Project ${age} v2`);
    setProgramEndDate(targetDate.toISOString().slice(0, 10));
    setShowPlannerModal(true);
  };

  const handleLaunchFocusGoals = async () => {
    const trimmedProgramName = String(programName || '').trim() || `Project ${age} v2`;
    const parsedEndDate = Date.parse(`${programEndDate}T12:00:00`);
    const safeEndDateMs = Number.isFinite(parsedEndDate) ? parsedEndDate : targetDate.getTime();
    const remainingDays = Math.max(1, Math.ceil((safeEndDateMs - Date.now()) / (24 * 60 * 60 * 1000)));
    const timeframe = remainingDays <= 21 ? 'sprint' : remainingDays <= 120 ? 'quarter' : 'year';
    const milestoneTitles = milestoneTitlesText
      .split('\n')
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    let autoSelectGoalIds: string[] | undefined;

    try {
      setLaunchingFocusFlow(true);
      if (currentUser?.uid) {
        const goalSnap = await getDocs(query(
          collection(db, 'goals'),
          where('ownerUid', '==', currentUser.uid),
          where('persona', '==', (currentPersona || 'personal')),
        ));
        const existingGoals = goalSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }));
        const normalizedTitle = trimmedProgramName.toLowerCase();
        const existingGoal = existingGoals.find((goal) => String(goal.title || '').trim().toLowerCase() === normalizedTitle) || null;
        if (existingGoal) {
          autoSelectGoalIds = [existingGoal.id];
        } else {
          const existingRefs = existingGoals.map((goal) => String(goal.ref || '')).filter(Boolean);
          const ref = generateRef('goal', existingRefs);
          const docRef = await addDoc(collection(db, 'goals'), {
            ref,
            title: trimmedProgramName,
            description: `Strategic umbrella goal for turning ${age}.`,
            theme: 1,
            size: 3,
            timeToMasterHours: 100,
            confidence: 0.6,
            status: 0,
            ownerUid: currentUser.uid,
            persona: currentPersona || 'personal',
            goalKind: 'umbrella',
            timeHorizon: remainingDays > 365 ? 'multi_year' : 'year',
            rollupMode: 'children_only',
            goalRequiresStory: false,
            endDate: safeEndDateMs,
            targetDate: new Date(safeEndDateMs).toISOString().slice(0, 10),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          autoSelectGoalIds = [docRef.id];
        }
      }
    } catch {
      autoSelectGoalIds = undefined;
    } finally {
      setLaunchingFocusFlow(false);
    }

    saveFocusWizardPrefill({
      title: trimmedProgramName,
      endDateMs: safeEndDateMs,
      timeframe,
      searchTerm: trimmedProgramName,
      autoSelectGoalIds,
      queuedLeafMilestones: milestoneTitles,
      source: 'birthday_banner',
      visionText: `${trimmedProgramName}: align focus goals and leaf milestones so I arrive at turning ${age} on ${new Date(safeEndDateMs).toLocaleDateString()} in strong shape and on track.`,
      autoRunMatch: false,
    });

    setShowPlannerModal(false);
    navigate('/focus-goals');
  };

  const { daysUntil, progress, isToday, isPast } = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysTotal = Math.floor((target.getTime() - new Date(target.getFullYear() - 1, target.getMonth(), target.getDate()).getTime()) / msPerDay);
    const daysLeft = Math.max(0, Math.floor((target.getTime() - today.getTime()) / msPerDay));
    
    const progressPercent = Math.round(((daysTotal - daysLeft) / daysTotal) * 100);

    return {
      daysUntil: daysLeft,
      progress: Math.min(100, Math.max(0, progressPercent)),
      isToday: daysLeft === 0,
      isPast: daysLeft < 0
    };
  }, [targetDate]);

  if (isPast || !showBanner) return null; // Don't show if date has passed or dismissed within 3 days

  const formattedDate = targetDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const focusProgramLabel = String(programName || `Project ${age} v2`).trim() || `Project ${age} v2`;

  return (
    <>
    <Card
      className="mb-3"
      style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        border: 'none',
        color: '#fff',
        boxShadow: '0 6px 18px rgba(102, 126, 234, 0.24)'
      }}
    >
      <Card.Body style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(10px)',
              flexShrink: 0
            }}
          >
            <Cake size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ margin: 0, fontSize: '13px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {focusProgramLabel}
            </div>
            <div style={{ marginTop: 2, fontSize: '11px', opacity: 0.88, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Program end {formattedDate} • {daysUntil} days left
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '18px', fontWeight: '800', lineHeight: 1 }}>
              {daysUntil}
            </div>
            <div style={{ fontSize: '10px', opacity: 0.85, marginTop: 2 }}>{progress}% elapsed</div>
          </div>
          <button 
            onClick={handleDismissBanner}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
            title="Dismiss for 3 days"
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <Button
            size="sm"
            variant="light"
            onClick={handleOpenPlanner}
            style={{
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '10px',
              fontWeight: 700,
            }}
          >
            Open focus goals
          </Button>
          {linkedGoalsCount > 0 && (
            <div style={{ fontSize: '11px', opacity: 0.85, display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto' }}>
              <Target size={12} />
              <span>{linkedGoalsCount} linked goal{linkedGoalsCount !== 1 ? 's' : ''}</span>
              <button
                onClick={() => navigate('/focus-goals')}
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  color: '#fff',
                  border: 'none',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '10px',
                  fontWeight: '600',
                }}
              >
                View
              </button>
            </div>
          )}
        </div>

        {/* Birthday message only on the day */}
        {isToday && (
          <div
            style={{
              marginTop: '6px',
              padding: '4px 6px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '3px',
              fontSize: '10px',
              fontStyle: 'italic',
              borderLeft: '2px solid rgba(255, 255, 255, 0.5)',
              textAlign: 'center'
            }}
          >
            Happy Birthday
          </div>
        )}
      </Card.Body>
    </Card>

    <Modal show={showPlannerModal} onHide={() => setShowPlannerModal(false)} centered>
      <Modal.Header closeButton>
        <Modal.Title>Birthday Focus Program</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small mb-3">
          Start a named focus-goal program for this milestone, then use parent and leaf goals in the wizard to break it down.
        </p>
        <Form.Group className="mb-3">
          <Form.Label>Program name</Form.Label>
          <Form.Control
            type="text"
            value={programName}
            onChange={(event) => setProgramName(event.target.value)}
            placeholder={`Project ${age} v2`}
          />
        </Form.Group>
        <Form.Group>
          <Form.Label>Target end date</Form.Label>
          <Form.Control
            type="date"
            value={programEndDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setProgramEndDate(event.target.value)}
          />
        </Form.Group>
        <Form.Group className="mt-3">
          <Form.Label>Leaf milestones</Form.Label>
          <Form.Control
            as="textarea"
            rows={4}
            value={milestoneTitlesText}
            onChange={(event) => setMilestoneTitlesText(event.target.value)}
            placeholder={'Build base fitness\nCut body fat\nPeak for birthday'}
          />
          <Form.Text muted>
            One milestone per line. The banner will seed these into the focus-goal wizard under the parent program goal.
          </Form.Text>
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setShowPlannerModal(false)}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void handleLaunchFocusGoals()} disabled={launchingFocusFlow}>
          {launchingFocusFlow ? 'Preparing…' : 'Open Focus Goals Wizard'}
        </Button>
      </Modal.Footer>
    </Modal>
    </>
  );
};

export default BirthdayMilestoneCard;
