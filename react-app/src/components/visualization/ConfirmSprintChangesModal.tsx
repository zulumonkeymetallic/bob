import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { GoalTimelineAffectedStory } from './goalTimelineImpact';

interface Props {
  visible: boolean;
  pendingChanges: {
    goalId: string;
    startDate: number;
    endDate: number;
    affectedStories: GoalTimelineAffectedStory[];
  } | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmSprintChangesModal: React.FC<Props> = ({
  visible,
  pendingChanges,
  onConfirm,
  onCancel
}) => {
  if (!visible || !pendingChanges) return null;

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  const movableStories = pendingChanges.affectedStories.filter(
    (story) => story.recommendedSprintId && story.recommendedSprintId !== story.plannedSprintId,
  );
  const unchangedStories = pendingChanges.affectedStories.filter(
    (story) => story.recommendedSprintId && story.recommendedSprintId === story.plannedSprintId,
  );
  const manualReviewStories = pendingChanges.affectedStories.length - movableStories.length - unchangedStories.length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="text-lg font-semibold">Confirm Sprint Changes</h3>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm text-amber-800">
              <strong>Warning:</strong> Changing this goal's timeline will evaluate {pendingChanges.affectedStories.length} linked stories
              and move each one to the sprint with the closest start date when a recommendation is available.
            </p>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Timeline Changes</h4>
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-gray-600">New Start Date:</span> 
                <span className="ml-2 font-medium">{formatDate(pendingChanges.startDate)}</span>
              </div>
              <div>
                <span className="text-gray-600">New End Date:</span> 
                <span className="ml-2 font-medium">{formatDate(pendingChanges.endDate)}</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Affected Stories</h4>
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-700">Story</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-700">Current Sprint</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-700">Recommended Sprint</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-700">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingChanges.affectedStories.map((story) => (
                    <tr key={story.id} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        <div>
                          <div className="font-medium">{story.ref}</div>
                          <div className="text-gray-600 text-xs truncate">{story.title}</div>
                          {typeof story.impactedTaskCount === 'number' && story.impactedTaskCount > 0 && (
                            <div className="text-gray-500 text-xs">{story.impactedTaskCount} linked task{story.impactedTaskCount === 1 ? '' : 's'}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {story.plannedSprintName || story.plannedSprintId || 'Unassigned'}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {story.recommendedSprintName || story.recommendedSprintId || 'Review manually'}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {story.recommendedSprintId
                          ? story.recommendedSprintId === story.plannedSprintId
                            ? 'Already closest'
                            : 'Will move'
                          : 'Manual review'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-800">
              <strong>What happens on confirm:</strong> {movableStories.length} stor{movableStories.length === 1 ? 'y' : 'ies'} will be reassigned automatically.
              {unchangedStories.length > 0 ? ` ${unchangedStories.length} stor${unchangedStories.length === 1 ? 'y is' : 'ies are'} already in the closest sprint and will stay put.` : ''}
              {manualReviewStories > 0 ? ` ${manualReviewStories} stor${manualReviewStories === 1 ? 'y has' : 'ies have'} no recommendation and will stay where they are for manual review.` : ''}
            </p>
          </div>
        </div>
        
        <div className="flex justify-end gap-3 p-4 border-t">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
          >
            Confirm and Move Stories
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmSprintChangesModal;
