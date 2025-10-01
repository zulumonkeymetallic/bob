import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Button, ButtonGroup, Form, Badge, Row, Col, Table, Modal } from 'react-bootstrap';
import { collection, onSnapshot, query, where, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Goal, Sprint } from '../types';
import { findSprintForDate } from '../utils/taskSprintHelpers';

interface SteamGame {
  id: string;
  appid: number;
  name: string;
  img_icon_url?: string;
  img_logo_url?: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
  rating?: number;
  lastConvertedStoryId?: string;
  lastConvertedAt?: number;
  completedAt?: number;
}

interface ConvertPayload {
  goalId: string;
  sprintId: string | null;
  targetDate: string;
  rating: number;
}

const buildCoverUrl = (appid: number) => `https://steamcdn-a.akamaihd.net/steam/apps/${appid}/header.jpg`;

const GamesBacklog: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [games, setGames] = useState<SteamGame[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unconverted' | 'converted'>('all');
  const [selectedGame, setSelectedGame] = useState<SteamGame | null>(null);
  const [convertForm, setConvertForm] = useState<ConvertPayload>({ goalId: '', sprintId: null, targetDate: '', rating: 3 });
  const [savingConversion, setSavingConversion] = useState(false);
  const pendingLookups = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!currentUser) return;
    const gamesQuery = query(collection(db, 'steam'), where('ownerUid', '==', currentUser.uid));
    const unsubscribe = onSnapshot(gamesQuery, (snapshot) => {
      const docs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as SteamGame[];
      docs.sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));
      setGames(docs);
    });
    return unsubscribe;
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const missing = games.filter(game => (!game.name || !game.img_logo_url) && !pendingLookups.current.has(game.appid));
    if (!missing.length) return;

    const callable = httpsCallable(functions, 'getSteamAppDetails');
    missing.slice(0, 5).forEach(async (game) => {
      try {
        pendingLookups.current.add(game.appid);
        const response: any = await callable({ appId: game.appid });
        const payload = response?.data || response;
        if (!payload) return;
        await updateDoc(doc(db, 'steam', `${currentUser.uid}_${game.appid}`), {
          name: payload.name,
          headerImage: payload.headerImage || null,
          shortDescription: payload.shortDescription || null,
          updatedAt: serverTimestamp()
        });
      } catch (error) {
        console.error('Failed to fetch Steam app details', { appid: game.appid, error });
      }
    });
  }, [games, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const goalsQuery = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona));
    const sprintsQuery = query(collection(db, 'sprints'), where('ownerUid', '==', currentUser.uid));

    const unsubGoals = onSnapshot(goalsQuery, snap => {
      setGoals(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[]);
    });
    const unsubSprints = onSnapshot(sprintsQuery, snap => {
      setSprints(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Sprint[]);
    });

    return () => {
      unsubGoals();
      unsubSprints();
    };
  }, [currentUser, currentPersona]);

  const filteredGames = useMemo(() => {
    return games.filter(game => {
      const matchesSearch = !search || game.name.toLowerCase().includes(search.toLowerCase());
      const converted = !!game.lastConvertedStoryId;
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'converted' ? converted : !converted);
      return matchesSearch && matchesStatus;
    });
  }, [games, search, statusFilter]);

  const handleRatingChange = async (game: SteamGame, rating: number) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, 'steam', game.id), {
        rating,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Failed to update rating', error);
      window.alert('Could not save rating. Please try again.');
    }
  };

  const openConvertModal = (game: SteamGame) => {
    setSelectedGame(game);
    setConvertForm({
      goalId: goals[0]?.id || '',
      sprintId: null,
      targetDate: '',
      rating: game.rating ?? 3
    });
  };

  const handleConvert = async () => {
    if (!currentUser || !selectedGame) return;
    if (!convertForm.goalId) {
      window.alert('Please choose a goal for this story.');
      return;
    }

    setSavingConversion(true);
    try {
      const dueDateMs = convertForm.targetDate ? new Date(convertForm.targetDate).getTime() : null;
      const sprintId = convertForm.sprintId || (dueDateMs ? findSprintForDate(sprints, dueDateMs)?.id || null : null);

      const storyPayload = {
        title: selectedGame.name,
        description: `Play and complete ${selectedGame.name}.` + (selectedGame.playtime_forever ? `\nSteam playtime: ${(selectedGame.playtime_forever / 60).toFixed(1)} hrs.` : ''),
        goalId: convertForm.goalId,
        sprintId: sprintId || null,
        dueDate: dueDateMs || null,
        status: 0,
        priority: 2,
        points: 3,
        wipLimit: 3,
        tags: ['steam', 'game'],
        persona: currentPersona,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        metadata: {
          steamAppId: selectedGame.appid,
          steamCover: buildCoverUrl(selectedGame.appid),
          rating: convertForm.rating
        }
      } as any;

      const storyDoc = await addDoc(collection(db, 'stories'), storyPayload);

      await updateDoc(doc(db, 'steam', selectedGame.id), {
        lastConvertedStoryId: storyDoc.id,
        lastConvertedAt: serverTimestamp(),
        completedAt: convertForm.targetDate ? new Date(convertForm.targetDate).getTime() : null,
        rating: convertForm.rating
      });

      setSelectedGame(null);
    } catch (error) {
      console.error('Failed to convert game to story', error);
      window.alert('Could not convert this game to a story.');
    } finally {
      setSavingConversion(false);
    }
  };

  const renderRatingStars = (game: SteamGame) => {
    const rating = game.rating ?? 0;
    return (
      <ButtonGroup size="sm">
        {[1,2,3,4,5].map((value) => (
          <Button
            key={value}
            variant={value <= rating ? 'warning' : 'outline-secondary'}
            onClick={() => handleRatingChange(game, value)}
          >
            ★
          </Button>
        ))}
      </ButtonGroup>
    );
  };

  const renderListView = () => (
    <Table striped hover responsive size="sm" className="mb-0">
      <thead>
        <tr>
          <th>Game</th>
          <th>Playtime</th>
          <th>Rating</th>
          <th>Status</th>
          <th style={{ width: 160 }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {filteredGames.map((game) => {
          const converted = !!game.lastConvertedStoryId;
          return (
            <tr key={game.id}>
              <td>
                <div className="d-flex align-items-center gap-2">
                  <img src={buildCoverUrl(game.appid)} alt={game.name} style={{ width: 80, height: 30, objectFit: 'cover', borderRadius: 4 }} />
                  <div>
                    <div className="fw-semibold">{game.name}</div>
                    <div className="text-muted small">AppID: {game.appid}</div>
                  </div>
                </div>
              </td>
              <td>{((game.playtime_forever || 0) / 60).toFixed(1)} hrs</td>
              <td>{renderRatingStars(game)}</td>
              <td>{converted ? <Badge bg="success">Story Linked</Badge> : <Badge bg="secondary">Backlog</Badge>}</td>
              <td>
                <div className="d-flex gap-2">
                  <Button size="sm" variant="outline-primary" onClick={() => openConvertModal(game)}>Convert to Story</Button>
                  {converted && <Button size="sm" variant="outline-secondary" href={`/stories?storyId=${game.lastConvertedStoryId}`}>View story</Button>}
                </div>
              </td>
            </tr>
          );
        })}
        {filteredGames.length === 0 && (
          <tr>
            <td colSpan={5} className="text-center text-muted py-4">No games match the current filters.</td>
          </tr>
        )}
      </tbody>
    </Table>
  );

  const renderCardView = () => (
    <Row xs={1} md={2} lg={3} className="g-3">
      {filteredGames.map((game) => {
        const converted = !!game.lastConvertedStoryId;
        return (
          <Col key={game.id}>
            <Card className="h-100 shadow-sm">
              <div style={{ height: 180, overflow: 'hidden', borderTopLeftRadius: '0.5rem', borderTopRightRadius: '0.5rem' }}>
                <img src={buildCoverUrl(game.appid)} alt={game.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <Card.Body className="d-flex flex-column">
                <Card.Title>{game.name}</Card.Title>
                <Card.Subtitle className="mb-2 text-muted">{((game.playtime_forever || 0) / 60).toFixed(1)} hrs played</Card.Subtitle>
                {game.lastConvertedStoryId && (
                  <div className="text-muted small mb-2">
                    Story ID: <code>{game.lastConvertedStoryId.slice(-8)}</code>
                  </div>
                )}
                <div className="mb-3">{renderRatingStars(game)}</div>
                <div className="mt-auto d-flex justify-content-between align-items-center">
                  {converted ? <Badge bg="success">Story Linked</Badge> : <Badge bg="secondary">Backlog</Badge>}
                  <Button size="sm" variant="outline-primary" onClick={() => openConvertModal(game)}>Convert</Button>
                </div>
              </Card.Body>
            </Card>
          </Col>
        );
      })}
      {filteredGames.length === 0 && (
        <Col><div className="text-center text-muted py-4">No games match the current filters.</div></Col>
      )}
    </Row>
  );

  return (
    <Card className="border-0 shadow-sm">
      <Card.Header className="bg-white d-flex flex-wrap gap-3 align-items-center justify-content-between">
        <div>
          <h5 className="mb-1">Games Backlog</h5>
          <div className="text-muted small">Imported from Steam — convert directly into stories.</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Form.Control size="sm" placeholder="Search games" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />
          <Form.Select size="sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={{ width: 160 }}>
            <option value="all">All games</option>
            <option value="unconverted">Backlog only</option>
            <option value="converted">Story linked</option>
          </Form.Select>
          <ButtonGroup size="sm">
            <Button variant={viewMode === 'list' ? 'primary' : 'outline-secondary'} onClick={() => setViewMode('list')}>List</Button>
            <Button variant={viewMode === 'card' ? 'primary' : 'outline-secondary'} onClick={() => setViewMode('card')}>Cards</Button>
          </ButtonGroup>
        </div>
      </Card.Header>
      <Card.Body>
        {viewMode === 'list' ? renderListView() : renderCardView()}
      </Card.Body>

      <Modal show={!!selectedGame} onHide={() => setSelectedGame(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Convert to Story</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Goal</Form.Label>
              <Form.Select
                value={convertForm.goalId}
                onChange={(e) => setConvertForm(prev => ({ ...prev, goalId: e.target.value }))}
              >
                <option value="">Select goal…</option>
                {goals.map(goal => (
                  <option key={goal.id} value={goal.id}>{goal.title}</option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Sprint (optional)</Form.Label>
              <Form.Select
                value={convertForm.sprintId || ''}
                onChange={(e) => setConvertForm(prev => ({ ...prev, sprintId: e.target.value || null }))}
              >
                <option value="">No sprint</option>
                {sprints.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Target / Completed date</Form.Label>
              <Form.Control
                type="date"
                value={convertForm.targetDate}
                onChange={(e) => setConvertForm(prev => ({ ...prev, targetDate: e.target.value }))}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Personal rating</Form.Label>
              <Form.Select
                value={convertForm.rating}
                onChange={(e) => setConvertForm(prev => ({ ...prev, rating: Number(e.target.value) }))}
              >
                {[1,2,3,4,5].map(star => (
                  <option key={star} value={star}>{`${'★'.repeat(star)}${'☆'.repeat(5-star)}`}</option>
                ))}
              </Form.Select>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setSelectedGame(null)}>Cancel</Button>
          <Button variant="primary" onClick={handleConvert} disabled={savingConversion}>
            {savingConversion ? 'Converting…' : 'Convert'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
};

export default GamesBacklog;
