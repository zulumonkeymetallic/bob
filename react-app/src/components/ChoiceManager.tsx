import React, { useState } from 'react';
import { Container, Row, Col, Card, Table, Button, Modal, Form, Badge, Alert } from 'react-bootstrap';
import { Edit3, Plus, Trash2, Save, X } from 'lucide-react';
import { ChoiceHelper } from '../config/choices';
import { useTheme } from '../contexts/ModernThemeContext';

interface ChoiceItem {
  value: number;
  label: string;
  color: string;
  active: boolean;
}

interface EditingChoice {
  table: string;
  field: string;
  value: number;
  label: string;
  color: string;
  active: boolean;
}

const ChoiceManager: React.FC = () => {
  const { theme } = useTheme();
  const [selectedTable, setSelectedTable] = useState<string>('goal');
  const [selectedField, setSelectedField] = useState<string>('status');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingChoice, setEditingChoice] = useState<EditingChoice | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  const getChoiceData = (table: string, field: string): ChoiceItem[] => {
    const choices = ChoiceHelper.getOptions(table, field);
    return choices.map(choice => ({
      value: choice.value,
      label: choice.label,
      color: ChoiceHelper.getColor(table, field, choice.value),
      active: true // All current choices are active
    }));
  };

  const handleEdit = (table: string, field: string, choice: ChoiceItem) => {
    setEditingChoice({
      table,
      field,
      value: choice.value,
      label: choice.label,
      color: choice.color,
      active: choice.active
    });
    setIsAddingNew(false);
    setShowEditModal(true);
  };

  const handleAddNew = () => {
    const existingChoices = getChoiceData(selectedTable, selectedField);
    const nextValue = Math.max(...existingChoices.map(c => c.value)) + 1;
    
    setEditingChoice({
      table: selectedTable,
      field: selectedField,
      value: nextValue,
      label: '',
      color: 'secondary',
      active: true
    });
    setIsAddingNew(true);
    setShowEditModal(true);
  };

  const handleSave = () => {
    if (!editingChoice) return;
    
    // Here you would typically save to a configuration system
    // For now, we'll just show an alert
    console.log('Saving choice:', editingChoice);
    alert(`Choice ${isAddingNew ? 'added' : 'updated'}: ${editingChoice.label}`);
    setShowEditModal(false);
    setEditingChoice(null);
  };

  const handleDelete = (table: string, field: string, value: number) => {
    if (window.confirm('Are you sure you want to delete this choice? This action cannot be undone.')) {
      console.log('Deleting choice:', { table, field, value });
      alert('Choice deleted');
    }
  };

  const availableColors = [
    'primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'
  ];

  const tables = [
    { value: 'goal', label: 'Goals' },
    { value: 'story', label: 'Stories' },
    { value: 'task', label: 'Tasks' },
    { value: 'sprint', label: 'Sprints' }
  ];

  const getFieldsForTable = (table: string) => {
    switch (table) {
      case 'goal':
        return [
          { value: 'status', label: 'Status' },
          { value: 'theme', label: 'Theme' },
          { value: 'size', label: 'Size' }
        ];
      case 'story':
        return [
          { value: 'status', label: 'Status' },
          { value: 'priority', label: 'Priority' },
          { value: 'theme', label: 'Theme' }
        ];
      case 'task':
        return [
          { value: 'status', label: 'Status' },
          { value: 'priority', label: 'Priority' },
          { value: 'theme', label: 'Theme' }
        ];
      case 'sprint':
        return [
          { value: 'status', label: 'Status' }
        ];
      default:
        return [];
    }
  };

  const currentChoices = getChoiceData(selectedTable, selectedField);

  return (
    <Container fluid className="p-4">
      <Row>
        <Col>
          <h2 className="mb-4">Choice Management</h2>
          <p className="text-muted">
            Manage choice lists for dropdowns and status fields. Similar to ServiceNow's sys_choice table.
          </p>
        </Col>
      </Row>

      <Row className="mb-4">
        <Col md={3}>
          <Form.Group>
            <Form.Label>Table</Form.Label>
            <Form.Select 
              value={selectedTable} 
              onChange={(e) => {
                setSelectedTable(e.target.value);
                setSelectedField(getFieldsForTable(e.target.value)[0]?.value || 'status');
              }}
            >
              {tables.map(table => (
                <option key={table.value} value={table.value}>
                  {table.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>
        <Col md={3}>
          <Form.Group>
            <Form.Label>Field</Form.Label>
            <Form.Select 
              value={selectedField} 
              onChange={(e) => setSelectedField(e.target.value)}
            >
              {getFieldsForTable(selectedTable).map(field => (
                <option key={field.value} value={field.value}>
                  {field.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>
        <Col md={3} className="d-flex align-items-end">
          <Button variant="primary" onClick={handleAddNew}>
            <Plus size={16} className="me-2" />
            Add Choice
          </Button>
        </Col>
      </Row>

      <Row>
        <Col>
          <Card>
            <Card.Header className="d-flex justify-content-between align-items-center">
              <h5 className="mb-0">
                {tables.find(t => t.value === selectedTable)?.label} - {getFieldsForTable(selectedTable).find(f => f.value === selectedField)?.label} Choices
              </h5>
              <Badge bg="info">{currentChoices.length} choices</Badge>
            </Card.Header>
            <Card.Body className="p-0">
              <Table striped hover className="mb-0">
                <thead>
                  <tr>
                    <th>Value</th>
                    <th>Label</th>
                    <th>Color Preview</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentChoices.map((choice) => (
                    <tr key={choice.value}>
                      <td>
                        <code>{choice.value}</code>
                      </td>
                      <td>{choice.label}</td>
                      <td>
                        <Badge bg={choice.color}>{choice.label}</Badge>
                      </td>
                      <td>
                        <Badge bg={choice.active ? 'success' : 'secondary'}>
                          {choice.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td>
                        <Button
                          variant="outline-primary"
                          size="sm"
                          className="me-2"
                          onClick={() => handleEdit(selectedTable, selectedField, choice)}
                        >
                          <Edit3 size={14} />
                        </Button>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          onClick={() => handleDelete(selectedTable, selectedField, choice.value)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Edit Modal */}
      <Modal show={showEditModal} onHide={() => setShowEditModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {isAddingNew ? 'Add New Choice' : 'Edit Choice'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {editingChoice && (
            <Form>
              <Form.Group className="mb-3">
                <Form.Label>Value</Form.Label>
                <Form.Control
                  type="number"
                  value={editingChoice.value}
                  onChange={(e) => setEditingChoice({
                    ...editingChoice,
                    value: parseInt(e.target.value) || 0
                  })}
                  disabled={!isAddingNew}
                />
                <Form.Text className="text-muted">
                  {isAddingNew ? 'Integer value stored in database' : 'Cannot change value for existing choice'}
                </Form.Text>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Label</Form.Label>
                <Form.Control
                  type="text"
                  value={editingChoice.label}
                  onChange={(e) => setEditingChoice({
                    ...editingChoice,
                    label: e.target.value
                  })}
                  placeholder="Display label"
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Color</Form.Label>
                <Form.Select
                  value={editingChoice.color}
                  onChange={(e) => setEditingChoice({
                    ...editingChoice,
                    color: e.target.value
                  })}
                >
                  {availableColors.map(color => (
                    <option key={color} value={color}>
                      {color.charAt(0).toUpperCase() + color.slice(1)}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Check
                  type="checkbox"
                  label="Active"
                  checked={editingChoice.active}
                  onChange={(e) => setEditingChoice({
                    ...editingChoice,
                    active: e.target.checked
                  })}
                />
              </Form.Group>

              <div className="border p-3 rounded bg-light">
                <Form.Label>Preview:</Form.Label>
                <div>
                  <Badge bg={editingChoice.color}>
                    {editingChoice.label || 'Preview'}
                  </Badge>
                </div>
              </div>
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowEditModal(false)}>
            <X size={16} className="me-2" />
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            <Save size={16} className="me-2" />
            {isAddingNew ? 'Add Choice' : 'Save Changes'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Row className="mt-4">
        <Col>
          <Alert variant="info">
            <h6>ServiceNow-Style Choice Management</h6>
            <ul className="mb-0">
              <li><strong>Integer Values:</strong> All choices use integer values (0, 1, 2, etc.) for database storage</li>
              <li><strong>Display Labels:</strong> User-friendly labels shown in the UI</li>
              <li><strong>Color Coding:</strong> Bootstrap color classes for visual consistency</li>
              <li><strong>Active/Inactive:</strong> Control which choices appear in dropdowns</li>
            </ul>
          </Alert>
        </Col>
      </Row>
    </Container>
  );
};

export default ChoiceManager;
