import React, { useState, useEffect } from 'react';
import { Dropdown, Form, Button, Modal, Badge } from 'react-bootstrap';

export interface ColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  order: number;
  editable: boolean;
  fieldType: 'text' | 'select' | 'number' | 'date' | 'readonly';
  options?: string[]; // For select fields
}

interface ColumnCustomizerProps {
  columns: ColumnConfig[];
  onColumnsChange: (columns: ColumnConfig[]) => void;
  tableId: string; // Unique identifier for this table's preferences
}

const ColumnCustomizer: React.FC<ColumnCustomizerProps> = ({
  columns,
  onColumnsChange,
  tableId
}) => {
  const [showModal, setShowModal] = useState(false);
  const [localColumns, setLocalColumns] = useState<ColumnConfig[]>(columns);

  useEffect(() => {
    // Load saved preferences from localStorage
    const savedPrefs = localStorage.getItem(`columnPrefs_${tableId}`);
    if (savedPrefs) {
      try {
        const parsedPrefs = JSON.parse(savedPrefs);
        const mergedColumns = columns.map(col => {
          const savedCol = parsedPrefs.find((p: ColumnConfig) => p.id === col.id);
          return savedCol ? { ...col, ...savedCol } : col;
        });
        setLocalColumns(mergedColumns);
        onColumnsChange(mergedColumns);
      } catch (error) {
        console.error('Error loading column preferences:', error);
      }
    }
  }, [tableId, columns, onColumnsChange]);

  const savePreferences = () => {
    localStorage.setItem(`columnPrefs_${tableId}`, JSON.stringify(localColumns));
    onColumnsChange(localColumns);
    setShowModal(false);
  };

  const resetToDefaults = () => {
    const defaultColumns = columns.map(col => ({ ...col, visible: true, order: col.order }));
    setLocalColumns(defaultColumns);
    localStorage.removeItem(`columnPrefs_${tableId}`);
  };

  const toggleColumnVisibility = (columnId: string) => {
    setLocalColumns(prev => 
      prev.map(col => 
        col.id === columnId ? { ...col, visible: !col.visible } : col
      )
    );
  };

  const moveColumn = (columnId: string, direction: 'up' | 'down') => {
    const sortedColumns = [...localColumns].sort((a, b) => a.order - b.order);
    const currentIndex = sortedColumns.findIndex(col => col.id === columnId);
    
    if (
      (direction === 'up' && currentIndex > 0) ||
      (direction === 'down' && currentIndex < sortedColumns.length - 1)
    ) {
      const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      const newColumns = [...localColumns];
      
      // Swap order values
      const currentCol = newColumns.find(col => col.id === columnId)!;
      const targetCol = newColumns.find(col => col.id === sortedColumns[newIndex].id)!;
      const tempOrder = currentCol.order;
      currentCol.order = targetCol.order;
      targetCol.order = tempOrder;
      
      setLocalColumns(newColumns);
    }
  };

  const visibleColumnsCount = localColumns.filter(col => col.visible).length;

  return (
    <>
      <Dropdown align="end">
        <Dropdown.Toggle variant="outline-secondary" size="sm" id="column-customizer">
          <i className="fas fa-cog"></i>
        </Dropdown.Toggle>

        <Dropdown.Menu>
          <Dropdown.Header>Quick Column Toggle</Dropdown.Header>
          {localColumns
            .sort((a, b) => a.order - b.order)
            .map(column => (
            <Dropdown.Item
              key={column.id}
              as="div"
              className="d-flex align-items-center"
              onClick={(e) => e.preventDefault()}
            >
              <Form.Check
                type="checkbox"
                id={`col-${column.id}`}
                label={column.label}
                checked={column.visible}
                onChange={() => toggleColumnVisibility(column.id)}
                disabled={column.visible && visibleColumnsCount === 1}
              />
            </Dropdown.Item>
          ))}
          <Dropdown.Divider />
          <Dropdown.Item onClick={() => setShowModal(true)}>
            <i className="fas fa-sliders-h me-2"></i>
            Advanced Settings
          </Dropdown.Item>
          <Dropdown.Item onClick={resetToDefaults}>
            <i className="fas fa-undo me-2"></i>
            Reset to Defaults
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>

      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="fas fa-columns me-2"></i>
            Customize Columns
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-3">
            <small className="text-muted">
              Toggle column visibility and reorder using arrow buttons.
              Changes will be saved automatically to your browser.
            </small>
          </div>

          <div>
            {localColumns
              .sort((a, b) => a.order - b.order)
              .map((column, index) => (
                <div
                  key={column.id}
                  className="card mb-2"
                >
                  <div className="card-body py-2">
                    <div className="d-flex align-items-center">
                      <div className="me-3">
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => moveColumn(column.id, 'up')}
                          disabled={index === 0}
                          className="me-1"
                        >
                          <i className="fas fa-chevron-up"></i>
                        </Button>
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => moveColumn(column.id, 'down')}
                          disabled={index === localColumns.length - 1}
                        >
                          <i className="fas fa-chevron-down"></i>
                        </Button>
                      </div>
                      
                      <div className="flex-grow-1">
                        <div className="d-flex align-items-center justify-content-between">
                          <div className="d-flex align-items-center">
                            <Form.Check
                              type="checkbox"
                              id={`modal-col-${column.id}`}
                              checked={column.visible}
                              onChange={() => toggleColumnVisibility(column.id)}
                              disabled={column.visible && visibleColumnsCount === 1}
                              className="me-3"
                            />
                            <strong className={column.visible ? '' : 'text-muted'}>
                              {column.label}
                            </strong>
                          </div>
                          
                          <div className="text-end">
                            <small className="text-muted me-3">
                              {column.editable ? (
                                <span className="text-success">
                                  <i className="fas fa-edit me-1"></i>
                                  Editable
                                </span>
                              ) : (
                                <span className="text-secondary">
                                  <i className="fas fa-lock me-1"></i>
                                  Read-only
                                </span>
                              )}
                            </small>
                            <Badge 
                              bg="secondary" 
                              className="text-capitalize"
                            >
                              {column.fieldType}
                            </Badge>
                          </div>
                        </div>
                        
                        {column.fieldType === 'select' && column.options && (
                          <div className="mt-1">
                            <small className="text-muted">
                              Options: {column.options.join(', ')}
                            </small>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>

          <div className="mt-3 p-3 bg-light rounded">
            <h6>Column Statistics</h6>
            <div className="row">
              <div className="col-md-4">
                <strong>{visibleColumnsCount}</strong> visible columns
              </div>
              <div className="col-md-4">
                <strong>{localColumns.filter(c => c.editable).length}</strong> editable fields
              </div>
              <div className="col-md-4">
                <strong>{localColumns.filter(c => c.fieldType === 'readonly').length}</strong> read-only fields
              </div>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={resetToDefaults}>
            Reset to Defaults
          </Button>
          <Button variant="primary" onClick={savePreferences}>
            Save Changes
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default ColumnCustomizer;

export {};
