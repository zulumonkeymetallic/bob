import React, { useEffect, useState } from 'react';
import { Card, Table, Form, Badge, Button, Alert } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { Link } from 'lucide-react';

type Goal = {
    id: string;
    title: string;
    estimatedCost?: number;
    potId?: string | null;
    status?: number;
};

type MonzoPot = {
    id: string;
    potId: string;
    name: string;
    balance: number;
    currency: string;
};

const GoalPotLinking: React.FC = () => {
    const { currentUser } = useAuth();
    const [goals, setGoals] = useState<Goal[]>([]);
    const [pots, setPots] = useState<MonzoPot[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);

    useEffect(() => {
        if (!currentUser) return;

        // Load goals with costs
        const goalsQuery = query(
            collection(db, 'goals'),
            where('ownerUid', '==', currentUser.uid)
        );

        const unsubGoals = onSnapshot(goalsQuery, (snap) => {
            const list = snap.docs
                .map(d => ({ id: d.id, ...(d.data() as any) } as Goal))
                .filter(g => g.status !== 2) // exclude completed goals
                .sort((a, b) => (b.estimatedCost || 0) - (a.estimatedCost || 0));
            setGoals(list);
            setLoading(false);
        });

        // Load Monzo pots
        const potsQuery = query(
            collection(db, 'monzo_pots'),
            where('ownerUid', '==', currentUser.uid)
        );

        const unsubPots = onSnapshot(potsQuery, (snap) => {
            const list = snap.docs.map(d => {
                const data = d.data() as any;
                return {
                    id: d.id,
                    potId: data.potId || d.id,
                    name: data.name || 'Pot',
                    balance: data.balance || 0,
                    currency: data.currency || 'GBP'
                } as MonzoPot;
            });
            setPots(list);
        });

        return () => {
            unsubGoals();
            unsubPots();
        };
    }, [currentUser]);

    const updatePotLink = async (goalId: string, potId: string) => {
        setSaving(goalId);
        try {
            const goalRef = doc(db, 'goals', goalId);
            await updateDoc(goalRef, {
                potId: potId || null,
                updatedAt: Date.now()
            });
        } catch (error) {
            console.error('Failed to update pot link', error);
        } finally {
            setSaving(null);
        }
    };

    const formatMoney = (val: number, currency: string = 'GBP') => {
        return val.toLocaleString('en-GB', { style: 'currency', currency });
    };

    if (loading) {
        return (
            <div className="container py-3">
                <div className="text-muted">Loading goals and pots...</div>
            </div>
        );
    }

    return (
        <div className="container py-3">
            <h3><Link size={24} className="me-2" />Goal to Pot Linking</h3>
            <p className="text-muted">
                Link your goals to Monzo pots. This allows the Finance Hub to track progress toward your goals using actual pot balances.
            </p>

            {pots.length === 0 && (
                <Alert variant="warning">
                    <Alert.Heading>No Monzo pots found</Alert.Heading>
                    <p>Connect your Monzo account and ensure you have pots set up to link them to goals.</p>
                </Alert>
            )}

            <Card>
                <Card.Body>
                    <Table hover responsive>
                        <thead>
                            <tr>
                                <th>Goal</th>
                                <th>Estimated Cost</th>
                                <th>Linked Pot</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {goals.map((goal) => {
                                const linkedPot = pots.find(p => p.potId === goal.potId);
                                return (
                                    <tr key={goal.id}>
                                        <td>
                                            <div className="fw-semibold">{goal.title}</div>
                                        </td>
                                        <td>
                                            {goal.estimatedCost != null ? (
                                                <span className="text-muted">{formatMoney(goal.estimatedCost)}</span>
                                            ) : (
                                                <span className="text-muted small">Not set</span>
                                            )}
                                        </td>
                                        <td>
                                            <Form.Select
                                                size="sm"
                                                value={goal.potId || ''}
                                                onChange={(e) => updatePotLink(goal.id, e.target.value)}
                                                disabled={saving === goal.id}
                                            >
                                                <option value="">No pot linked</option>
                                                {pots.map(pot => (
                                                    <option key={pot.potId} value={pot.potId}>
                                                        {pot.name} ({formatMoney(pot.balance / 100, pot.currency)})
                                                    </option>
                                                ))}
                                            </Form.Select>
                                        </td>
                                        <td>
                                            {linkedPot ? (
                                                <Badge bg="success" pill>Linked</Badge>
                                            ) : (
                                                <Badge bg="secondary" pill>Unlinked</Badge>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {goals.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="text-center text-muted">
                                        No active goals found. Create goals with estimated costs to link them to pots.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>

                    {pots.length > 0 && (
                        <div className="mt-3">
                            <h6 className="mb-2">Available Pots</h6>
                            <div className="d-flex flex-wrap gap-2">
                                {pots.map(pot => (
                                    <Badge key={pot.potId} bg="light" text="dark" className="border">
                                        {pot.name}: {formatMoney(pot.balance / 100, pot.currency)}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}
                </Card.Body>
            </Card>
        </div>
    );
};

export default GoalPotLinking;
