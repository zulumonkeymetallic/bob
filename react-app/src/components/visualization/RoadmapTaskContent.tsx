import React from 'react';
import { Edit3, Wand2, Calendar as CalendarIcon, List as ListIcon, Star } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

interface RoadmapTaskContentProps {
    task: any;
    zoomLevel: 'year' | 'month' | 'week' | 'quarter';
    onEdit: (task: any) => void;
    onGenerateStories: (task: any) => void;
    onSchedule: (task: any) => void;
    onOpenStream: (task: any) => void;
}

const RoadmapTaskContent: React.FC<RoadmapTaskContentProps> = ({
    task,
    zoomLevel,
    onEdit,
    onGenerateStories,
    onSchedule,
    onOpenStream
}) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    // If it's a theme group (root item), just render the text
    if (task.type === 'project' || task.isThemeGroup) {
        return (
            <div className="gantt-task-content theme-group-header">
                <span className="theme-dot" style={{ backgroundColor: task.themeColor }} />
                <span className="theme-text" style={{ color: task.themeColor }}>{task.text}</span>
            </div>
        );
    }

    const isMilestone = task.duration <= 0 || task.isMilestone;
    const pct = task.progress ? Math.round(task.progress * 100) : 0;

    // Progress bars data
    const pointsPct = task.pointsPct || 0;
    const totalPoints = task.totalPoints || 0;
    const financePct = task.financePct || 0;
    const hasFinance = task.hasFinance || false;
    const recentNote = task.recentNote;

    // Show details only in detailed views
    const showDetails = !isMilestone && (zoomLevel === 'week' || zoomLevel === 'month');

    return (
        <div className={`gantt-task-content ${task.theme ? `gantt-theme-${task.theme}` : 'gantt-theme-1'}`}>
            <div className="gantt-task-main">
                <div className={`gantt-task-title ${isMilestone ? 'milestone-title' : ''}`} title={task.text}>
                    {task.text}
                </div>

                {!isMilestone && (
                    <div
                        className="gantt-task-completion-badge"
                        style={{
                            background: isDark ? 'rgba(0,0,0,.4)' : 'rgba(255,255,255,.82)',
                            color: isDark ? '#fff' : '#111827'
                        }}
                    >
                        {pct}%
                    </div>
                )}

                {isMilestone && (
                    <div className="gantt-milestone-icon">
                        <Star size={18} strokeWidth={1.6} />
                    </div>
                )}
            </div>

            {showDetails && (
                <div className="gantt-task-details">
                    {/* Story points progress bar */}
                    {totalPoints > 0 && (
                        <div className="gantt-progress-row">
                            <div className="gantt-progress-label">
                                Points: {pointsPct}%
                            </div>
                            <div className="gantt-progress-track">
                                <div
                                    className="gantt-progress-fill"
                                    style={{ width: `${pointsPct}%`, background: isDark ? 'rgba(59,130,246,.85)' : 'rgba(59,130,246,.75)' }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Finance/savings progress bar */}
                    {hasFinance && (
                        <div className="gantt-progress-row">
                            <div className="gantt-progress-label">
                                Saved: {financePct}%
                            </div>
                            <div className="gantt-progress-track">
                                <div
                                    className="gantt-progress-fill"
                                    style={{ width: `${Math.min(100, financePct)}%`, background: isDark ? 'rgba(34,197,94,.85)' : 'rgba(34,197,94,.75)' }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Recent Note */}
                    {recentNote && (
                        <div className="gantt-task-note">📝 {recentNote}</div>
                    )}
                </div>
            )}

            {/* Hover Actions */}
            <div className="gantt-hover-actions" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" title="Edit Goal" onClick={(e) => { e.stopPropagation(); onEdit(task); }}>
                    <Edit3 size={14} />
                </button>
                <button className="icon-btn" title="Generate Stories" onClick={(e) => { e.stopPropagation(); onGenerateStories(task); }}>
                    <Wand2 size={14} />
                </button>
                <button className="icon-btn" title="AI Schedule Time" onClick={(e) => { e.stopPropagation(); onSchedule(task); }}>
                    <CalendarIcon size={14} />
                </button>
                <button className="icon-btn" title="Open Activity Stream" onClick={(e) => { e.stopPropagation(); onOpenStream(task); }}>
                    <ListIcon size={14} />
                </button>
            </div>
        </div>
    );
};

export default RoadmapTaskContent;
