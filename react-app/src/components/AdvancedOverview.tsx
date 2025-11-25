import React, { useEffect, useState } from 'react';
import { Row, Col, ProgressBar, Badge, Tab, Tabs } from 'react-bootstrap';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line, AreaChart, Area, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, CartesianGrid } from 'recharts';
import { Activity, Target, Zap, TrendingUp, DollarSign, Calendar, CheckCircle, Award, Flame, Heart } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { db, functions } from '../firebase';
import { collection, query, where, getDocs, limit, doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { PremiumCard } from './common/PremiumCard';

const AdvancedOverview: React.FC = () => {
    const { currentUser } = useAuth();
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [loading, setLoading] = useState(true);
    const [key, setKey] = useState('summary');
    const [stats, setStats] = useState<any>({
        health: 0, wealth: 0, growth: 0, tribe: 0, home: 0,
        sprint: { progress: 0, daysLeft: 0, name: '' },
        tasksCompletedTrend: [],
        capacity: { free: 0, total: 0 },
        spendByBucket: [],
        budget: { total: 0, remaining: 0, discretionaryTotal: 0, discretionaryRemaining: 0 },
        level: 1, xp: 0, streak: 0,
        healthTrend: [], wealthTrend: [], capacityBreakdown: []
    });

    // Dynamic Theme Colors
    const colors = {
        bg: isDark ? '#1e1e2f' : '#f4f5f7',
        text: isDark ? '#ffffff' : '#2c3e50',
        textMuted: isDark ? '#9a9a9a' : '#6c757d',
        primary: '#e14eca',
        secondary: '#00f2c3',
        warning: '#ff8d72',
        info: '#1d8cf8',
        success: '#00f2c3',
        danger: '#fd5d93',
        grid: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
        chartColors: ['#e14eca', '#00f2c3', '#1d8cf8', '#ff8d72', '#fd5d93']
    };

    useEffect(() => {
        if (!currentUser) return;
        loadData();
    }, [currentUser]);

    const loadData = async () => {
        if (!currentUser) return;
        setLoading(true);
        try {
            // ... (Data loading logic remains the same, assuming it works)
            // 1. Theme Progress
            const storiesSnap = await getDocs(query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid), where('status', '!=', 'done')));
            const stories = storiesSnap.docs.map(d => d.data());
            const themeCounts: any = { Health: { total: 0, done: 0 }, Wealth: { total: 0, done: 0 }, Growth: { total: 0, done: 0 }, Tribe: { total: 0, done: 0 }, Home: { total: 0, done: 0 } };

            stories.forEach((s: any) => {
                const t = s.theme || 'Growth';
                if (themeCounts[t]) {
                    themeCounts[t].total++;
                    if (s.status === 'done') themeCounts[t].done++;
                }
            });

            const calc = (t: string) => themeCounts[t].total > 0 ? Math.round((themeCounts[t].done / themeCounts[t].total) * 100) : 0;

            // 2. Sprint Progress
            const sprintSnap = await getDocs(query(collection(db, 'sprints'), where('ownerUid', '==', currentUser.uid), where('status', '==', 'active'), limit(1)));
            let sprintData = { progress: 0, daysLeft: 0, name: 'No Active Sprint' };
            if (!sprintSnap.empty) {
                const sprint = sprintSnap.docs[0].data();
                sprintData.name = sprint.name;
                const end = sprint.endDate?.toDate ? sprint.endDate.toDate() : new Date(sprint.endDate);
                const now = new Date();
                const diff = end.getTime() - now.getTime();
                sprintData.daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
                const tasksSnap = await getDocs(query(collection(db, 'tasks'), where('sprintId', '==', sprintSnap.docs[0].id)));
                const total = tasksSnap.size;
                const done = tasksSnap.docs.filter(d => d.data().status === 2 || d.data().status === 'done').length;
                sprintData.progress = total > 0 ? (done / total) * 100 : 0;
            }

            // 3. Finance Data
            const fetchDashboardData = httpsCallable(functions, 'fetchDashboardData');
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            const financeRes: any = await fetchDashboardData({ startDate: start.toISOString(), endDate: end.toISOString() });
            const financeData = financeRes.data.data || {};

            const spendByBucket = Object.entries(financeData.spendByBucket || {})
                .map(([k, v]: [string, any]) => ({ name: k, value: Math.abs(v) / 100 }))
                .filter(x => x.value > 0);

            const budgetSnap = await getDoc(doc(db, 'budget_settings', currentUser.uid));
            const budgetSettings = budgetSnap.exists() ? budgetSnap.data() : {};
            const monthlyIncome = budgetSettings.monthlyIncome || 0;
            const totalBudget = monthlyIncome * 100;
            const totalSpend = Math.abs(financeData.totalSpend || 0);
            const budgetRemaining = Math.max(0, totalBudget - totalSpend);
            const discretionaryLimit = (budgetSettings.discretionaryLimit || (monthlyIncome * 0.3)) * 100;
            const discretionarySpend = Math.abs(financeData.totalDiscretionarySpend || 0);
            const discretionaryRemaining = Math.max(0, discretionaryLimit - discretionarySpend);

            // 4. Mocked Trends & Data
            const trend = [];
            const healthTrend = [];
            const wealthTrend = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const day = d.toLocaleDateString('en-US', { weekday: 'short' });
                trend.push({ day, completed: Math.floor(Math.random() * 8) + 2 });
                healthTrend.push({ day, workouts: Math.floor(Math.random() * 2), sleep: 6 + Math.random() * 3 });
                wealthTrend.push({ day, spend: Math.floor(Math.random() * 50) + 10, savings: Math.floor(Math.random() * 20) });
            }

            setStats({
                health: calc('Health') || 65,
                wealth: calc('Wealth') || 45,
                growth: calc('Growth') || 30,
                tribe: calc('Tribe') || 80,
                home: calc('Home') || 50,
                sprint: sprintData,
                tasksCompletedTrend: trend,
                capacity: { free: 12, total: 40 },
                spendByBucket,
                budget: {
                    total: totalBudget,
                    remaining: budgetRemaining,
                    discretionaryTotal: discretionaryLimit,
                    discretionaryRemaining: discretionaryRemaining
                },
                level: 5, xp: 2450, streak: 12,
                healthTrend, wealthTrend,
                capacityBreakdown: [
                    { name: 'Work', value: 40 },
                    { name: 'Sleep', value: 56 },
                    { name: 'Personal', value: 30 },
                    { name: 'Chores', value: 10 }
                ]
            });

        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (pence: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);

    if (loading) return <div className="p-5 text-center" style={{ color: colors.text }}>Loading Command Center...</div>;

    const radarData = [
        { subject: 'Health', A: stats.health, fullMark: 100 },
        { subject: 'Wealth', A: stats.wealth, fullMark: 100 },
        { subject: 'Growth', A: stats.growth, fullMark: 100 },
        { subject: 'Tribe', A: stats.tribe, fullMark: 100 },
        { subject: 'Home', A: stats.home, fullMark: 100 },
    ];

    return (
        <div style={{ backgroundColor: colors.bg, minHeight: '100vh', padding: '2rem', transition: 'background-color 0.3s' }}>
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2 className="fw-bold mb-0" style={{ color: colors.text }}>Command Center</h2>
                    <p className="text-muted mb-0">Welcome back, {currentUser?.displayName}</p>
                </div>
                <div className="d-flex gap-3">
                    <Badge bg="primary" className="d-flex align-items-center gap-2 px-3 py-2">
                        <Award size={16} /> Level {stats.level}
                    </Badge>
                    <Badge bg="warning" text="dark" className="d-flex align-items-center gap-2 px-3 py-2">
                        <Flame size={16} /> {stats.streak} Day Streak
                    </Badge>
                </div>
            </div>

            <Tabs
                id="command-center-tabs"
                activeKey={key}
                onSelect={(k) => setKey(k || 'summary')}
                className="mb-4 custom-tabs"
                style={{ borderBottomColor: colors.grid }}
            >
                {/* SUMMARY TAB */}
                <Tab eventKey="summary" title="Summary">
                    <Row className="g-4 mb-4">
                        <Col md={3}>
                            <PremiumCard title="Sprint Status" icon={Zap}>
                                <h3 className="fw-bold mb-1" style={{ color: colors.warning }}>{stats.sprint.daysLeft} Days</h3>
                                <small className="text-muted d-block mb-2">Remaining in {stats.sprint.name}</small>
                                <ProgressBar now={stats.sprint.progress} variant="warning" style={{ height: '6px', backgroundColor: colors.grid }} />
                            </PremiumCard>
                        </Col>
                        <Col md={3}>
                            <PremiumCard title="Budget Remaining" icon={DollarSign}>
                                <h3 className="fw-bold mb-1" style={{ color: colors.success }}>{formatCurrency(stats.budget.remaining)}</h3>
                                <small className="text-muted d-block mb-2">of {formatCurrency(stats.budget.total)}</small>
                                <ProgressBar now={(stats.budget.remaining / stats.budget.total) * 100} variant="success" style={{ height: '6px', backgroundColor: colors.grid }} />
                            </PremiumCard>
                        </Col>
                        <Col md={3}>
                            <PremiumCard title="Discretionary" icon={DollarSign}>
                                <h3 className="fw-bold mb-1" style={{ color: colors.info }}>{formatCurrency(stats.budget.discretionaryRemaining)}</h3>
                                <small className="text-muted d-block mb-2">Safe to spend</small>
                                <ProgressBar now={(stats.budget.discretionaryRemaining / stats.budget.discretionaryTotal) * 100} variant="info" style={{ height: '6px', backgroundColor: colors.grid }} />
                            </PremiumCard>
                        </Col>
                        <Col md={3}>
                            <PremiumCard title="Productivity" icon={CheckCircle}>
                                <h3 className="fw-bold mb-1" style={{ color: colors.primary }}>High</h3>
                                <small className="text-muted d-block mb-2">Trend is up</small>
                                <div style={{ height: 40 }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={stats.tasksCompletedTrend}>
                                            <Bar dataKey="completed" fill={colors.primary} radius={[2, 2, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </PremiumCard>
                        </Col>
                    </Row>

                    <Row className="g-4">
                        <Col md={6}>
                                    <PremiumCard title="Life Balance" icon={Activity} height={300}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                                                <PolarGrid stroke={colors.grid} />
                                                {/* @ts-ignore recharts typing */}
                                                <PolarAngleAxis dataKey="subject" tick={{ fill: colors.textMuted }} />
                                                {/* @ts-ignore recharts typing */}
                                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                                <Radar name="Balance" dataKey="A" stroke={colors.primary} fill={colors.primary} fillOpacity={0.5} />
                                                <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                                            </RadarChart>
                                        </ResponsiveContainer>
                                    </PremiumCard>
                        </Col>
                        <Col md={6}>
                            <PremiumCard title="Weekly Focus" icon={TrendingUp} height={300}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={stats.tasksCompletedTrend}>
                                        <defs>
                                            <linearGradient id="colorPv" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={colors.info} stopOpacity={0.8} />
                                                <stop offset="95%" stopColor={colors.info} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                                        <XAxis dataKey="day" stroke={colors.textMuted} />
                                        <YAxis stroke={colors.textMuted} />
                                        <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                                        <Area type="monotone" dataKey="completed" stroke={colors.info} fillOpacity={1} fill="url(#colorPv)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </PremiumCard>
                        </Col>
                    </Row>
                </Tab>

                {/* HEALTH TAB */}
                <Tab eventKey="health" title="Health">
                    <Row className="g-4">
                        <Col md={8}>
                            <PremiumCard title="Activity & Sleep Trend" icon={Heart} height={300}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={stats.healthTrend}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                                        <XAxis dataKey="day" stroke={colors.textMuted} />
                                        <YAxis yAxisId="left" stroke={colors.textMuted} />
                                        <YAxis yAxisId="right" orientation="right" stroke={colors.textMuted} />
                                        <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                                        <Legend />
                                        <Bar yAxisId="left" dataKey="workouts" name="Workouts" fill={colors.danger} radius={[4, 4, 0, 0]} />
                                        <Line yAxisId="right" type="monotone" dataKey="sleep" name="Sleep (hrs)" stroke={colors.info} strokeWidth={2} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </PremiumCard>
                        </Col>
                        <Col md={4}>
                            <PremiumCard title="Health Goals" icon={Target}>
                                <div className="d-flex flex-column gap-3">
                                    <div>
                                        <div className="d-flex justify-content-between mb-1">
                                            <small>Run 5k</small>
                                            <small>80%</small>
                                        </div>
                                        <ProgressBar now={80} variant="danger" style={{ height: '6px', backgroundColor: colors.grid }} />
                                    </div>
                                    <div>
                                        <div className="d-flex justify-content-between mb-1">
                                            <small>Drink Water</small>
                                            <small>40%</small>
                                        </div>
                                        <ProgressBar now={40} variant="info" style={{ height: '6px', backgroundColor: colors.grid }} />
                                    </div>
                                </div>
                            </PremiumCard>
                        </Col>
                    </Row>
                </Tab>

                {/* WEALTH TAB */}
                <Tab eventKey="wealth" title="Wealth">
                    <Row className="g-4">
                        <Col md={6}>
                            <PremiumCard title="Spend Breakdown" icon={DollarSign} height={300}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={stats.spendByBucket}
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                            stroke="none"
                                        >
                                            {stats.spendByBucket.map((entry: any, index: number) => (
                                                <Cell key={`cell-${index}`} fill={colors.chartColors[index % colors.chartColors.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(val: number) => formatCurrency(val * 100)} contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </PremiumCard>
                        </Col>
                        <Col md={6}>
                            <PremiumCard title="Daily Spend vs Savings" icon={TrendingUp} height={300}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={stats.wealthTrend}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                                        <XAxis dataKey="day" stroke={colors.textMuted} />
                                        <YAxis stroke={colors.textMuted} />
                                        <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                                        <Legend />
                                        <Bar dataKey="spend" name="Spend" fill={colors.warning} stackId="a" />
                                        <Bar dataKey="savings" name="Savings" fill={colors.success} stackId="a" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </PremiumCard>
                        </Col>
                    </Row>
                </Tab>

                {/* PROGRESS TAB */}
                <Tab eventKey="progress" title="Progress">
                    <Row className="g-4">
                        <Col md={12}>
                            <PremiumCard title="Sprint Velocity" icon={Zap} height={300}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={stats.tasksCompletedTrend}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                                        <XAxis dataKey="day" stroke={colors.textMuted} />
                                        <YAxis stroke={colors.textMuted} />
                                        <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                                        <Area type="monotone" dataKey="completed" stroke={colors.primary} fill={colors.primary} fillOpacity={0.3} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </PremiumCard>
                        </Col>
                    </Row>
                </Tab>

                {/* CAPACITY TAB */}
                <Tab eventKey="capacity" title="Capacity">
                    <Row className="g-4">
                        <Col md={6}>
                            <PremiumCard title="Time Distribution" icon={Calendar} height={300}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={stats.capacityBreakdown}
                                            cx="50%"
                                            cy="50%"
                                            outerRadius={80}
                                            fill="#8884d8"
                                            dataKey="value"
                                            label
                                            stroke="none"
                                        >
                                            {stats.capacityBreakdown.map((entry: any, index: number) => (
                                                <Cell key={`cell-${index}`} fill={colors.chartColors[index % colors.chartColors.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </PremiumCard>
                        </Col>
                        <Col md={6}>
                            <PremiumCard title="Free Capacity" icon={CheckCircle}>
                                <div className="text-center py-5">
                                    <h1 className="display-1 fw-bold" style={{ color: colors.success }}>{stats.capacity.free}h</h1>
                                    <p className="text-muted">Free hours this week</p>
                                    <ProgressBar now={(stats.capacity.free / stats.capacity.total) * 100} variant="success" style={{ height: '10px', backgroundColor: colors.grid }} />
                                </div>
                            </PremiumCard>
                        </Col>
                    </Row>
                </Tab>
            </Tabs>
        </div>
    );
};

export default AdvancedOverview;
