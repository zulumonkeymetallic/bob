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
import { useTheme } from '../../contexts/ThemeContext';
import GoalTimelineGrid from './GoalTimelineGrid';
import SprintMarkers from './SprintMarkers';
import ShareLinkDialog from './ShareLinkDialog';
import ConfirmSprintChangesModal from './ConfirmSprintChangesModal';
import './GoalVisualization.css';

export interface Goal {
  id: string;
  ref: string;
  title: string;
  themeId: string;
  startDate?: number;
  endDate?: number;
  status: string;
  progress?: number;
  ownerUid: string;
}

export interface Sprint {
  id: string;
  ref: string;
  title: string;
  startDate: number;
  endDate: number;
  status: string;
}

export interface Story {
  id: string;
  ref: string;
  title: string;
  goalId: string;
  plannedSprintId?: string;
  status: string;
}

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

  // Mock themes for now
  const themes = [
    { id: 'health', name: 'Health & Fitness', color: '#52c41a' },
    { id: 'career', name: 'Career', color: '#1890ff' },
    { id: 'personal', name: 'Personal Growth', color: '#722ed1' },
    { id: 'finance', name: 'Finance', color: '#fa8c16' },
  ];

  useEffect(() => {
    loadData();
  }, [currentUser]);

  const loadData = async () => {
    setLoading(true);
    try {
      // TODO: Load from Firestore
      // Mock data for scaffolding
      setGoals([
        {
          id: '1',
          ref: 'GR-26LGIP',
          title: 'Complete Iron Man Training',
          themeId: 'health',
          startDate: Date.now(),
          endDate: Date.now() + (180 * 24 * 60 * 60 * 1000), // 6 months
          status: 'in-progress',
          progress: 35,
          ownerUid: currentUser?.uid || ''
        },
        {
          id: '2',
          ref: 'GR-27HKJM',
          title: 'Senior Developer Promotion',
          themeId: 'career',
          startDate: Date.now() - (30 * 24 * 60 * 60 * 1000),
          endDate: Date.now() + (90 * 24 * 60 * 60 * 1000),
          status: 'in-progress',
          progress: 60,
          ownerUid: currentUser?.uid || ''
        }
      ]);

      setSprints([
        {
          id: 'sprint1',
          ref: 'SPR-001',
          title: 'Q4 Sprint 1',
          startDate: Date.now(),
          endDate: Date.now() + (14 * 24 * 60 * 60 * 1000),
          status: 'active'
        },
        {
          id: 'sprint2',
          ref: 'SPR-002',
          title: 'Q4 Sprint 2',
          startDate: Date.now() + (14 * 24 * 60 * 60 * 1000),
          endDate: Date.now() + (28 * 24 * 60 * 60 * 1000),
          status: 'planned'
        }
      ]);

      setStories([
        {
          id: 'story1',
          ref: 'STRY-001',
          title: 'Complete swim training program',
          goalId: '1',
          plannedSprintId: 'sprint1',
          status: 'in-progress'
        },
        {
          id: 'story2',
          ref: 'STRY-002',
          title: 'Finish React certification',
          goalId: '2',
          plannedSprintId: 'sprint1',
          status: 'todo'
        }
      ]);
    } catch (error) {
      console.error('Error loading visualization data:', error);
      alert('Failed to load visualization data');
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
      // TODO: Update Firestore
      // Update local state for now
      setGoals(prev => prev.map(goal => 
        goal.id === goalId 
          ? { ...goal, startDate, endDate }
          : goal
      ));
      
      // Log activity
      // TODO: ActivityStreamService.logFieldChange
      
      alert('Goal dates updated successfully');
    } catch (error) {
      console.error('Error updating goal dates:', error);
      alert('Failed to update goal dates');
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
