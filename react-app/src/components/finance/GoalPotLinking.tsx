import React, { useEffect, useMemo, useState } from 'react';
import { Card, Table, Form, Badge, Alert, InputGroup, Row, Col } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs } from 'firebase/firestore';
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
    const [goalSearch, setGoalSearch] = useState('');
    const [potSearch, setPotSearch] = useState('');
    const [storyCounts, setStoryCounts] = useState<Record<string, number>>({});
    const [storyCountsLoaded, setStoryCountsLoaded] = useState(false);
    const [showLinkedOnly, setShowLinkedOnly] = useState(false);
    const [showWithStoriesOnly, setShowWithStoriesOnly] = useState(true);

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

    useEffect(() => {
        if (!currentUser) return;
        // Fetch story counts to flag active goals
        const loadStories = async () => {
            const q = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
            const snap = await getDocs(q);
            const counts: Record<string, number> = {};
            snap.docs.forEach(d => {
                const data = d.data() as any;
                const gid = data.goalId || data.goal_id;
                if (!gid) return;
                counts[gid] = (counts[gid] || 0) + 1;
            });
            setStoryCounts(counts);
            setStoryCountsLoaded(true);
        };
        loadStories().catch(err => console.warn('Failed to load stories for goal filters', err));
    }, [currentUser]);

    const updatePotLink = async (goalId: string, potId: string) => {
        setSaving(goalId);
        try {
            const goalRef = doc(db, 'goals', goalId);
            await updateDoc(goalRef, {
                potId: potId || null,
                linkedPotId: potId || null,
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

    const filteredGoals = useMemo(() => {
        return goals.filter(g => {
            if (showWithStoriesOnly && storyCountsLoaded && (storyCounts[g.id] || 0) === 0) return false;
            if (showLinkedOnly && !g.potId) return false;
            if (goalSearch.trim() && !g.title.toLowerCase().includes(goalSearch.toLowerCase())) return false;
            return true;
        });
    }, [goals, goalSearch, showLinkedOnly, showWithStoriesOnly, storyCounts, storyCountsLoaded]);

    const filteredPots = useMemo(() => {
        return pots
            .filter((p) => {
                // Exclude archived/closed pots; fallback to non-zero balance when no explicit flag
                const isDeleted = (p as any).deleted === true || (p as any).closed === true;
                const hasBalance = (p.balance || 0) > 0;
                const include = !isDeleted && hasBalance;
                return include;
            })
            .filter((p) => {
                if (!potSearch.trim()) return true;
                return p.name.toLowerCase().includes(potSearch.toLowerCase());
            });
    }, [pots, potSearch]);

    const totalPotBalance = pots.reduce((sum, pot) => sum + pot.balance, 0);

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

            <Card className="mb-3">
                <Card.Body>
                    <Row className="g-3 align-items-end">
                        <Col md={6}>
                            <Form.Label className="mb-1">Filter goals</Form.Label>
                            <InputGroup>
                                <InputGroup.Text>🔍</InputGroup.Text>
                                <Form.Control
                                    size="sm"
                                    placeholder="Search goals by name"
                                    value={goalSearch}
                                    onChange={(e) => setGoalSearch(e.target.value)}
                                />
                            </InputGroup>
                            <div className="d-flex flex-wrap gap-3 mt-2">
                                <Form.Check
                                    type="switch"
                                    id="filter-stories"
                                    label="Only goals with stories"
                                    checked={showWithStoriesOnly}
                                    onChange={(e) => setShowWithStoriesOnly(e.target.checked)}
                                />
                                <Form.Check
                                    type="switch"
                                    id="filter-linked"
                                    label="Linked only"
                                    checked={showLinkedOnly}
                                    onChange={(e) => setShowLinkedOnly(e.target.checked)}
                                />
                            </div>
                        </Col>
                        <Col md={6}>
                            <Form.Label className="mb-1">Filter pots</Form.Label>
                            <InputGroup>
                                <InputGroup.Text>🔍</InputGroup.Text>
                                <Form.Control
                                    size="sm"
                                    placeholder="Search pots by name"
                                    value={potSearch}
                                    onChange={(e) => setPotSearch(e.target.value)}
                                />
                            </InputGroup>
                        </Col>
                    </Row>
                    {pots.length > 0 && (
                        <div className="mt-3 small text-muted">
                            {pots.length} pots • Total balance {formatMoney(totalPotBalance / 100)}
                        </div>
                    )}
                </Card.Body>
            </Card>

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
                                <th>Stories</th>
                                <th>Linked Pot</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredGoals.map((goal) => {
                                const linkedPot = pots.find(p => p.potId === goal.potId);
                                const potOptions = linkedPot && !filteredPots.find(p => p.potId === linkedPot.potId)
                                    ? [linkedPot, ...filteredPots]
                                    : filteredPots;
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
                                            <Badge bg={storyCounts[goal.id] ? 'success' : 'secondary'}>
                                                {storyCounts[goal.id] || 0}
                                            </Badge>
                                        </td>
                                        <td>
                                            <Form.Select
                                                size="sm"
                                                value={goal.potId || ''}
                                                onChange={(e) => updatePotLink(goal.id, e.target.value)}
                                                disabled={saving === goal.id}
                                            >
                                                <option value="">No pot linked</option>
                                                {potOptions.map(pot => (
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
                            {filteredGoals.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="text-center text-muted">
                                        {goals.length === 0 ? 'No active goals found. Create goals with estimated costs to link them to pots.' : 'No goals match this filter.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>

                    {pots.length > 0 && (
                        <div className="mt-3">
                            <h6 className="mb-2">Available Pots</h6>
                            <div className="d-flex flex-wrap gap-2">
                                {filteredPots.map(pot => (
                                    <Badge key={pot.potId} bg="light" text="dark" className="border">
                                        {pot.name}: {formatMoney(pot.balance / 100, pot.currency)}
                                    </Badge>
                                ))}
                                {filteredPots.length === 0 && <span className="text-muted small">No pots match this filter.</span>}
                            </div>
                        </div>
                    )}
                </Card.Body>
            </Card>
        </div>
    );
};

export default GoalPotLinking;
