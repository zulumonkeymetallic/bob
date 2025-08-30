import React, { useState, useEffect } from 'react';
import { Button, Dropdown, Badge, Tooltip, OverlayTrigger } from 'react-bootstrap';
import { PencilSquare, Check2, X, ThreeDots } from 'react-bootstrap-icons';
import '../styles/GlobalEditButton.css';

interface GlobalEditButtonProps {
  isEditMode: boolean;
  selectedCount: number;
  onToggleEditMode: () => void;
  onBulkEdit?: (action: string) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  bulkActions?: Array<{
    key: string;
    label: string;
    icon?: React.ReactNode;
    variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  }>;
  position?: 'top-right' | 'top-left';
  disabled?: boolean;
}

const GlobalEditButton: React.FC<GlobalEditButtonProps> = ({
  isEditMode,
  selectedCount,
  onToggleEditMode,
  onBulkEdit,
  onSelectAll,
  onDeselectAll,
  bulkActions = [],
  position = 'top-right',
  disabled = false
}) => {
  const [showBulkActions, setShowBulkActions] = useState(false);

  // Default bulk actions if none provided
  const defaultBulkActions = [
    { key: 'edit', label: 'Edit Selected', icon: <PencilSquare size={14} />, variant: 'primary' as const },
    { key: 'delete', label: 'Delete Selected', icon: <X size={14} />, variant: 'danger' as const },
    { key: 'duplicate', label: 'Duplicate Selected', icon: <ThreeDots size={14} />, variant: 'secondary' as const }
  ];

  const actions = bulkActions.length > 0 ? bulkActions : defaultBulkActions;

  const handleBulkAction = (actionKey: string) => {
    if (onBulkEdit) {
      onBulkEdit(actionKey);
    }
    setShowBulkActions(false);
  };

  const toggleEditModeTooltip = (
    <Tooltip id="toggle-edit-tooltip">
      {isEditMode ? 'Exit edit mode' : 'Enter edit mode to select and bulk edit records'}
    </Tooltip>
  );

  const bulkActionsTooltip = (
    <Tooltip id="bulk-actions-tooltip">
      Perform actions on {selectedCount} selected record{selectedCount !== 1 ? 's' : ''}
    </Tooltip>
  );

  return (
    <div 
      className={`global-edit-controls position-fixed ${position === 'top-right' ? 'top-0 end-0' : 'top-0 start-0'}`}
      style={{
        zIndex: 1050,
        margin: '1rem',
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center'
      }}
    >
      {/* Edit Mode Toggle Button */}
      <OverlayTrigger placement="bottom" overlay={toggleEditModeTooltip}>
        <Button
          variant={isEditMode ? 'success' : 'outline-primary'}
          size="sm"
          onClick={onToggleEditMode}
          disabled={disabled}
          className="d-flex align-items-center gap-1"
          style={{
            minWidth: '100px',
            fontWeight: '500',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}
        >
          {isEditMode ? (
            <>
              <Check2 size={16} />
              Done
            </>
          ) : (
            <>
              <PencilSquare size={16} />
              Edit
            </>
          )}
        </Button>
      </OverlayTrigger>

      {/* Selection Count and Actions */}
      {isEditMode && (
        <>
          {/* Selection Count Badge */}
          {selectedCount > 0 && (
            <Badge 
              bg="primary" 
              className="px-2 py-1"
              style={{
                fontSize: '0.75rem',
                borderRadius: '6px'
              }}
            >
              {selectedCount} selected
            </Badge>
          )}

          {/* Select All/Deselect All */}
          <div className="btn-group" role="group">
            {onSelectAll && (
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={onSelectAll}
                style={{ borderRadius: '6px 0 0 6px' }}
              >
                All
              </Button>
            )}
            {onDeselectAll && selectedCount > 0 && (
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={onDeselectAll}
                style={{ borderRadius: onSelectAll ? '0 6px 6px 0' : '6px' }}
              >
                None
              </Button>
            )}
          </div>

          {/* Bulk Actions Dropdown */}
          {selectedCount > 0 && (
            <OverlayTrigger placement="bottom" overlay={bulkActionsTooltip}>
              <Dropdown show={showBulkActions} onToggle={setShowBulkActions}>
                <Dropdown.Toggle
                  variant="primary"
                  size="sm"
                  id="bulk-actions-dropdown"
                  className="d-flex align-items-center gap-1"
                  style={{
                    borderRadius: '8px',
                    fontWeight: '500'
                  }}
                >
                  <ThreeDots size={16} />
                  Actions
                </Dropdown.Toggle>

                <Dropdown.Menu 
                  style={{
                    minWidth: '180px',
                    borderRadius: '8px',
                    border: '1px solid var(--bs-border-color)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                  }}
                >
                  {actions.map((action) => (
                    <Dropdown.Item
                      key={action.key}
                      onClick={() => handleBulkAction(action.key)}
                      className={`d-flex align-items-center gap-2 ${action.variant === 'danger' ? 'text-danger' : ''}`}
                      style={{
                        padding: '0.5rem 1rem',
                        fontSize: '0.875rem'
                      }}
                    >
                      {action.icon}
                      {action.label}
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown>
            </OverlayTrigger>
          )}
        </>
      )}
    </div>
  );
};

export default GlobalEditButton;
