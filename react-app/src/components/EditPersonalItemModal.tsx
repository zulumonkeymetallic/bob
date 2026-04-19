import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import { db } from '../firebase';
import { doc, updateDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

// Define PersonalItem interface locally if not exported, or import it.
// Since it was defined locally in PersonalListsManagement, I'll redefine it here or export it there.
// For safety, I'll redefine it compatible with the usage.
export interface PersonalItem {
    id: string;
    title: string;
    description?: string;
    category: 'personal' | 'work' | 'learning' | 'health' | 'finance';
    priority: 'low' | 'medium' | 'high';
    status: 'todo' | 'in-progress' | 'waiting' | 'done';
    dueDate?: number;
    tags?: string[];
    createdAt: number;
    updatedAt: number;
    ownerUid: string;
    persona: string;
}

interface EditPersonalItemModalProps {
    item: PersonalItem | null;
    onClose: () => void;
    show: boolean;
    currentUserId: string;
    currentPersona: string;
}

const EditPersonalItemModal: React.FC<EditPersonalItemModalProps> = ({ item, onClose, show, currentUserId, currentPersona }) => {
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        category: 'personal',
        priority: 'medium',
        status: 'todo',
        dueDate: '',
        tags: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitResult, setSubmitResult] = useState<string | null>(null);

    useEffect(() => {
        if (show) {
            if (item) {
                // Edit mode
                setFormData({
                    title: item.title,
                    description: item.description || '',
                    category: item.category,
                    priority: item.priority,
                    status: item.status,
                    dueDate: item.dueDate ? new Date(item.dueDate).toISOString().slice(0, 10) : '',
                    tags: item.tags ? item.tags.join(', ') : ''
                });
            } else {
                // Create mode
                setFormData({
                    title: '',
                    description: '',
                    category: 'personal',
                    priority: 'medium',
                    status: 'todo',
                    dueDate: '',
                    tags: ''
                });
            }
        }
    }, [item, show]);

    const handleSubmit = async () => {
        if (!formData.title.trim()) return;

        setIsSubmitting(true);
        setSubmitResult(null);

        try {
            const itemData: any = {
                title: formData.title.trim(),
                description: formData.description.trim(),
                category: formData.category,
                priority: formData.priority,
                status: formData.status,
                dueDate: formData.dueDate ? new Date(formData.dueDate).getTime() : null,
                tags: formData.tags.split(',').map(t => t.trim()).filter(t => t),
                updatedAt: serverTimestamp()
            };

            if (item) {
                // Update
                await updateDoc(doc(db, 'personalItems', item.id), itemData);
                setSubmitResult('✅ Item updated successfully!');
            } else {
                // Create
                itemData.createdAt = serverTimestamp();
                itemData.ownerUid = currentUserId;
                itemData.persona = currentPersona;
                await addDoc(collection(db, 'personalItems'), itemData);
                setSubmitResult('✅ Item created successfully!');
            }

            setTimeout(() => {
                onClose();
                setSubmitResult(null);
            }, 1000);

        } catch (error: any) {
            console.error('Error saving personal item:', error);
            setSubmitResult(`❌ Failed: ${error.message}`);
        }
        setIsSubmitting(false);
    };

    return (
        <Modal show={show} onHide={onClose} centered>
            <Modal.Header closeButton>
                <Modal.Title>{item ? 'Edit Item' : 'New Personal Item'}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <Form>
                    <Form.Group className="mb-3">
                        <Form.Label>Title *</Form.Label>
                        <Form.Control
                            type="text"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            placeholder="What do you need to do?"
                            autoFocus
                        />
                    </Form.Group>

                    <Form.Group className="mb-3">
                        <Form.Label>Description</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={3}
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Add details..."
                        />
                    </Form.Group>

                    <div className="row">
                        <div className="col-md-6">
                            <Form.Group className="mb-3">
                                <Form.Label>Category</Form.Label>
                                <Form.Select
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                >
                                    <option value="personal">Personal</option>
                                    <option value="work">Work</option>
                                    <option value="learning">Learning</option>
                                    <option value="health">Health</option>
                                    <option value="finance">Finance</option>
                                </Form.Select>
                            </Form.Group>
                        </div>
                        <div className="col-md-6">
                            <Form.Group className="mb-3">
                                <Form.Label>Priority</Form.Label>
                                <Form.Select
                                    value={formData.priority}
                                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                                >
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                </Form.Select>
                            </Form.Group>
                        </div>
                    </div>

                    <div className="row">
                        <div className="col-md-6">
                            <Form.Group className="mb-3">
                                <Form.Label>Status</Form.Label>
                                <Form.Select
                                    value={formData.status}
                                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                >
                                    <option value="todo">To Do</option>
                                    <option value="in-progress">In Progress</option>
                                    <option value="waiting">Waiting</option>
                                    <option value="done">Done</option>
                                </Form.Select>
                            </Form.Group>
                        </div>
                        <div className="col-md-6">
                            <Form.Group className="mb-3">
                                <Form.Label>Due Date</Form.Label>
                                <Form.Control
                                    type="date"
                                    value={formData.dueDate}
                                    onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                                />
                            </Form.Group>
                        </div>
                    </div>

                    <Form.Group className="mb-3">
                        <Form.Label>Tags</Form.Label>
                        <Form.Control
                            type="text"
                            value={formData.tags}
                            onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                            placeholder="comma, separated, tags"
                        />
                    </Form.Group>

                    {submitResult && (
                        <Alert variant={submitResult.includes('✅') ? 'success' : 'danger'}>
                            {submitResult}
                        </Alert>
                    )}
                </Form>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    onClick={handleSubmit}
                    disabled={isSubmitting || !formData.title.trim()}
                >
                    {isSubmitting ? 'Saving...' : (item ? 'Update Item' : 'Create Item')}
                </Button>
            </Modal.Footer>
        </Modal>
    );
};

export default EditPersonalItemModal;
