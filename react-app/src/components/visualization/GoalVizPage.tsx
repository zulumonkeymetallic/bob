import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
  ZoomIn, 
  ZoomOut, 
  Home, 
  Printer, 
  Share2,
  Filter,
  Search,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ModernThemeContext';
import { getGoalsData } from '../../services/dataService';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { ActivityStreamService } from '../../services/ActivityStreamService';
import { Goal, Sprint, Story, Theme } from './types';
import GoalTimelineGrid from './GoalTimelineGrid';
import SprintMarkers from './SprintMarkers';
import ShareLinkDialog from './ShareLinkDialog';
import ConfirmSprintChangesModal from './ConfirmSprintChangesModal';
import './GoalVisualization.css';

const GoalVizPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  
  // State
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  
  // UI State
  const [zoomLevel, setZoomLevel] = useState<'month' | 'quarter' | 'half' | 'year'>('quarter');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedThemes, setSelectedThemes] = useState<string[]>([]);
  const [collapsedGoals, setCollapsedGoals] = useState<Set<string>>(new Set());
  
  // Modals
  const [shareDialogVisible, setShareDialogVisible] = useState(false);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<any>(null);

  // BOB Platform Themes
  const themes = [
    { id: 'health', name: 'Health & Fitness', color: '#ef4444' },
    { id: 'growth', name: 'Personal Growth', color: '#8b5cf6' },
    { id: 'wealth', name: 'Wealth & Finance', color: '#059669' },
    { id: 'tribe', name: 'Tribe & Relationships', color: '#f59e0b' },
    { id: 'home', name: 'Home & Environment', color: '#3b82f6' },
  ];

  useEffect(() => {
    loadData();
  }, [currentUser]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (!currentUser?.uid) {
        setLoading(false);
        return;
      }

      // Load real goals data
      const goalsData = await getGoalsData(currentUser.uid);
      const loadedGoals = goalsData.map((goal: any) => ({
        id: goal.id,
        ref: goal.ref || goal.referenceNumber || `GR-${goal.id.slice(-6).toUpperCase()}`,
        title: goal.title || goal.goalTitle || 'Untitled Goal',
        themeId: goal.themeId || goal.theme || 'personal',
        startDate: goal.startDate || goal.createdAt || Date.now(),
        endDate: goal.targetDate || goal.endDate || (Date.now() + (90 * 24 * 60 * 60 * 1000)), // Default 90 days
        status: goal.status || 'new',
        progress: goal.progress || 0,
        ownerUid: goal.ownerUid
      }));

      // Load sprints data
      const sprintsQuery = query(
        collection(db, 'sprints'), 
        where('ownerUid', '==', currentUser.uid)
      );
      const sprintsSnapshot = await getDocs(sprintsQuery);
      const loadedSprints = sprintsSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ref: data.ref || data.referenceNumber || `SP-${doc.id.slice(-6).toUpperCase()}`,
          title: data.title || data.sprintName || 'Untitled Sprint',
          startDate: data.startDate || Date.now(),
          endDate: data.endDate || (Date.now() + (14 * 24 * 60 * 60 * 1000)), // Default 2 weeks
          status: data.status || 'planned'
        };
      });

      // Load stories data for goal-story relationships
      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid)
      );
      const storiesSnapshot = await getDocs(storiesQuery);
      const loadedStories = storiesSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ref: data.ref || data.referenceNumber || `ST-${doc.id.slice(-6).toUpperCase()}`,
          title: data.title || data.storyTitle || 'Untitled Story',
          goalId: data.goalId || data.parentGoalId || '',
          plannedSprintId: data.plannedSprintId || data.sprintId || '',
          status: data.status || 'backlog'
        };
      });

      setGoals(loadedGoals);
      setSprints(loadedSprints);
      setStories(loadedStories);
      
      console.log('📊 Goal Visualization data loaded:', {
        goals: loadedGoals.length,
        sprints: loadedSprints.length,
        stories: loadedStories.length
      });

    } catch (error) {
      console.error('Error loading visualization data:', error);
      // Fallback to empty arrays
      setGoals([]);
      setSprints([]);
      setStories([]);
    } finally {
      setLoading(false);
    }
  };

  const handleZoomChange = (level: string) => {
    setZoomLevel(level as any);
    // TODO: Save to ui_state
  };

  const handleThemeFilter = (themes: string[]) => {
    setSelectedThemes(themes);
    // TODO: Save to ui_state
  };

  const handleGoalDateChange = (goalId: string, startDate: number, endDate: number) => {
    // Calculate affected stories
    const affectedStories = stories.filter(story => story.goalId === goalId);
    
    if (affectedStories.length >= 3) {
      setPendingChanges({ goalId, startDate, endDate, affectedStories });
      setConfirmModalVisible(true);
    } else {
      // Direct update for small changes
      applyDateChanges(goalId, startDate, endDate);
    }
  };

  const applyDateChanges = async (goalId: string, startDate: number, endDate: number) => {
    try {
      if (!currentUser?.uid) {
        throw new Error('User not authenticated');
      }

      // Update Firestore
      const goalRef = doc(db, 'goals', goalId);
      await updateDoc(goalRef, {
        startDate,
        endDate: endDate,
        targetDate: endDate, // BOB uses targetDate field
        updatedAt: Date.now()
      });

      // Update local state
      setGoals(prev => prev.map(goal => 
        goal.id === goalId 
          ? { ...goal, startDate, endDate }
          : goal
      ));
      
      // Log activity to activity stream
      const goal = goals.find(g => g.id === goalId);
      if (goal) {
        await ActivityStreamService.logFieldChange(
          goalId,
          'goal',
          'Date Range',
          `${new Date(goal.startDate || 0).toLocaleDateString()} - ${new Date(goal.endDate || 0).toLocaleDateString()}`,
          `${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}`,
          currentUser.uid,
          currentUser.email || undefined,
          undefined, // persona
          goal.ref
        );
      }
      
      console.log('📊 Goal dates updated successfully:', goalId);
    } catch (error) {
      console.error('Error updating goal dates:', error);
      throw error;
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleShare = () => {
    setShareDialogVisible(true);
  };

  const jumpToToday = () => {
    // TODO: Scroll timeline to current date
    alert('Jumping to today...');
  };

  const filteredGoals = goals.filter(goal => {
    const matchesSearch = goal.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         goal.ref.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTheme = selectedThemes.length === 0 || selectedThemes.includes(goal.themeId);
    return matchesSearch && matchesTheme;
  });

  if (loading) {
    return (
      <div className="goal-viz-loading p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading goal visualization...</p>
      </div>
    );
  }

  return (
    <div className="goal-visualization-page p-6">
      {/* Top Controls */}
      <div className="viz-controls bg-white rounded-lg shadow-sm border p-4 mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Search */}
          <div className="flex items-center gap-2 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search goals..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          {/* Theme Filter */}
          <div className="flex items-center gap-2 min-w-[200px]">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              multiple
              value={selectedThemes}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions, option => option.value);
                handleThemeFilter(selected);
              }}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {themes.map(theme => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </div>
          
          {/* Zoom Level */}
          <select 
            value={zoomLevel} 
            onChange={(e) => handleZoomChange(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
            <option value="half">Half Year</option>
            <option value="year">Year</option>
          </select>
          
          {/* Today Button */}
          <button
            onClick={jumpToToday}
            className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 transition-colors"
          >
            <Home className="w-4 h-4" />
            Today
          </button>
          
          <div className="flex-1" />
          
          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <Share2 className="w-4 h-4" />
              Share
            </button>
          </div>
        </div>
      </div>

      {/* Main Visualization */}
      <div className="viz-content bg-white rounded-lg shadow-sm border">
        <SprintMarkers sprints={sprints} zoomLevel={zoomLevel} />
        
        <GoalTimelineGrid
          goals={filteredGoals}
          stories={stories}
          sprints={sprints}
          themes={themes}
          zoomLevel={zoomLevel}
          collapsedGoals={collapsedGoals}
          onGoalCollapse={(goalId) => {
            const newCollapsed = new Set(collapsedGoals);
            if (newCollapsed.has(goalId)) {
              newCollapsed.delete(goalId);
            } else {
              newCollapsed.add(goalId);
            }
            setCollapsedGoals(newCollapsed);
          }}
          onGoalDateChange={handleGoalDateChange}
        />
      </div>

      {/* Modals */}
      {shareDialogVisible && (
        <ShareLinkDialog
          visible={shareDialogVisible}
          onClose={() => setShareDialogVisible(false)}
          themes={selectedThemes}
          goals={filteredGoals.map(g => g.id)}
        />
      )}
      
      {confirmModalVisible && (
        <ConfirmSprintChangesModal
          visible={confirmModalVisible}
          pendingChanges={pendingChanges}
          onConfirm={() => {
            if (pendingChanges) {
              applyDateChanges(pendingChanges.goalId, pendingChanges.startDate, pendingChanges.endDate);
            }
            setConfirmModalVisible(false);
            setPendingChanges(null);
          }}
          onCancel={() => {
            setConfirmModalVisible(false);
            setPendingChanges(null);
          }}
        />
      )}
    </div>
  );
};

export default GoalVizPage;
