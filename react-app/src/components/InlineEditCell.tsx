import React, { useState, useRef, useEffect } from 'react';
import { Form, Button, Spinner } from 'react-bootstrap';

interface InlineEditCellProps {
  value: any;
  fieldType: 'text' | 'select' | 'number' | 'date' | 'readonly';
  options?: string[];
  onSave: (newValue: any) => void;
  editable: boolean;
  className?: string;
  placeholder?: string;
  variant?: 'default' | 'success' | 'warning' | 'info';
}

const InlineEditCell: React.FC<InlineEditCellProps> = ({
  value,
  fieldType,
  options = [],
  onSave,
  editable,
  className = '',
  placeholder = '',
  variant = 'default'
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const inputRef = useRef<any>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      // Select all text for better UX
      if (inputRef.current.select) {
        inputRef.current.select();
      }
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleSave = async () => {
    if (editValue !== value) {
      setIsSaving(true);
      try {
        await onSave(editValue);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 1500);
      } catch (error) {
        console.error('Save failed:', error);
        setEditValue(value); // Revert on error
      } finally {
        setIsSaving(false);
      }
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isSaving) {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const getVariantColor = () => {
    const colors = {
      default: 'text-dark',
      success: 'text-success',
      warning: 'text-warning', 
      info: 'text-info'
    };
    return colors[variant] || colors.default;
  };

  const renderDisplayValue = () => {
    if (fieldType === 'date' && value) {
      return new Date(value).toLocaleDateString();
    }
    
    if (fieldType === 'select' && value) {
      return value;
    }
    
    return value || (
      <span className="text-muted fst-italic opacity-75">
        {placeholder || 'Click to edit...'}
      </span>
    );
  };

  const renderEditField = () => {
    const commonProps = {
      ref: inputRef,
      size: 'sm' as 'sm',
      onKeyDown: handleKeyPress,
      onBlur: handleSave,
      autoFocus: true,
      disabled: isSaving,
      className: 'shadow-sm border-primary'
    };

    switch (fieldType) {
      case 'select':
        return (
          <Form.Select
            {...commonProps}
            value={editValue || ''}
            onChange={(e) => setEditValue(e.target.value)}
            className="shadow-sm border-primary focus-ring-primary"
          >
            <option value="">Select...</option>
            {options.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Form.Select>
        );

      case 'number':
        return (
          <Form.Control
            {...commonProps}
            type="number"
            value={editValue || ''}
            onChange={(e) => setEditValue(e.target.value ? parseFloat(e.target.value) : '')}
            placeholder={placeholder}
            className="shadow-sm border-primary focus-ring-primary"
          />
        );

      case 'date':
        return (
          <Form.Control
            {...commonProps}
            type="date"
            value={editValue ? new Date(editValue).toISOString().split('T')[0] : ''}
            onChange={(e) => setEditValue(e.target.value)}
            className="shadow-sm border-primary focus-ring-primary"
          />
        );

      case 'text':
      default:
        return (
          <Form.Control
            {...commonProps}
            type="text"
            value={editValue || ''}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={placeholder}
            className="shadow-sm border-primary focus-ring-primary"
          />
        );
    }
  };

  if (!editable || fieldType === 'readonly') {
    return (
      <div className={`${className} text-muted d-flex align-items-center`}>
        {renderDisplayValue()}
        {!editable && (
          <small className="ms-2 text-secondary opacity-75">
            <i className="fas fa-lock" title="Read-only field"></i>
          </small>
        )}
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className={`${className} d-flex align-items-center gap-2 p-1 bg-light rounded`}>
        <div className="flex-grow-1">
          {renderEditField()}
        </div>
        <div className="d-flex gap-1">
          <Button
            size="sm"
            variant="success"
            onClick={handleSave}
            disabled={isSaving}
            className="d-flex align-items-center justify-content-center"
            style={{ width: '32px', height: '32px' }}
            title="Save changes"
          >
            {isSaving ? (
              <Spinner size="sm" />
            ) : (
              <i className="fas fa-check"></i>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={handleCancel}
            disabled={isSaving}
            className="d-flex align-items-center justify-content-center"
            style={{ width: '32px', height: '32px' }}
            title="Cancel editing"
          >
            <i className="fas fa-times"></i>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${className} ${getVariantColor()} position-relative`}
      onClick={() => editable && setIsEditing(true)}
      style={{ 
        minHeight: '2rem',
        cursor: editable ? 'pointer' : 'default',
        padding: '0.375rem 0.5rem',
        borderRadius: '0.375rem',
        transition: 'all 0.2s ease-in-out'
      }}
      title={editable ? 'Click to edit' : 'Read-only field'}
      onMouseEnter={(e) => {
        if (editable) {
          e.currentTarget.style.backgroundColor = 'rgba(13, 110, 253, 0.1)';
          e.currentTarget.style.borderLeft = '3px solid #0d6efd';
        }
      }}
      onMouseLeave={(e) => {
        if (editable) {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.borderLeft = 'none';
        }
      }}
    >
      <div className="d-flex align-items-center justify-content-between">
        <span className="flex-grow-1">
          {renderDisplayValue()}
        </span>
        {editable && (
          <div className="edit-indicators ms-2">
            <small className="text-primary opacity-50 me-1">
              <i className="fas fa-edit"></i>
            </small>
            {showSuccess && (
              <small className="text-success">
                <i className="fas fa-check-circle" title="Saved successfully"></i>
              </small>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default InlineEditCell;

export {};
