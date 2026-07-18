import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Button, ButtonGroup, Form, Badge, Row, Col, Table, Modal, Spinner } from 'react-bootstrap';
import { Gamepad2 } from 'lucide-react';
import { collection, onSnapshot, query, where, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Goal, Sprint } from '../types';
import { findSprintForDate } from '../utils/taskSprintHelpers';
import { generateRef } from '../utils/referenceGenerator';

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

type GamePlatform = 'steam' | 'ios' | 'android' | 'switch' | 'playstation' | 'xbox' | 'other';

const PLATFORM_LABELS: Record<GamePlatform, string> = {
  steam: 'Steam',
  ios: 'iOS',
  android: 'Android',
  switch: 'Switch',
  playstation: 'PlayStation',
  xbox: 'Xbox',
  other: 'Other'
};

interface ManualGameStory {
  id: string;
  title: string;
  status?: number | string;
  metadata?: {
    platform?: GamePlatform;
    artworkUrl?: string;
    rating?: number;
  };
}

interface ConvertPayload {
  goalId: string;
  sprintId: string | null;
  targetDate: string;
  rating: number;
}

interface ManualAddForm {
  title: string;
  platform: GamePlatform;
  artworkUrl: string;
  goalId: string;
  sprintId: string | null;
  targetDate: string;
}

interface ITunesResult {
  trackId: number;
  trackName: string;
  artworkUrl512?: string;
  artworkUrl100?: string;
  sellerName?: string;
}

// Unified shape used by the list/card renderers so Steam-sourced items (still living in the
// `steam` collection) and manually-added items (created directly as `stories` docs) can share
// one rendering path.
interface GameItem {
  key: string;
  sourceType: 'steam' | 'story';
  name: string;
  platform: GamePlatform;
  appid?: number;
  artworkUrl?: string;
  playtimeMinutes?: number;
  rating?: number;
  converted: boolean;
  storyId?: string;
  steamGame?: SteamGame;
}

const buildCoverUrl = (appid: number) => `https://steamcdn-a.akamaihd.net/steam/apps/${appid}/header.jpg`;

const resolveCoverUrl = (item: GameItem): string | null => {
  if (item.platform === 'steam' && item.appid != null) {
    return buildCoverUrl(item.appid);
  }
  if (item.artworkUrl) {
    return item.artworkUrl;
  }
  return null;
};

const emptyManualForm: ManualAddForm = {
  title: '',
  platform: 'ios',
  artworkUrl: '',
  goalId: '',
  sprintId: null,
  targetDate: ''
};

const GamesBacklog: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [games, setGames] = useState<SteamGame[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unconverted' | 'converted'>('all');
  const [selectedGame, setSelectedGame] = useState<SteamGame | null>(null);
  const [convertForm, setConvertForm] = useState<ConvertPayload>({ goalId: '', sprintId: null, targetDate: '', rating: 3 });
  const [savingConversion, setSavingConversion] = useState(false);
  const pendingLookups = useRef<Set<number>>(new Set());

  const [manualGames, setManualGames] = useState<ManualGameStory[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [manualForm, setManualForm] = useState<ManualAddForm>(emptyManualForm);
  const [savingManualAdd, setSavingManualAdd] = useState(false);
  const [itunesResults, setItunesResults] = useState<ITunesResult[]>([]);
  const [itunesLoading, setItunesLoading] = useState(false);
  const [itunesError, setItunesError] = useState<string | null>(null);

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

    const unsubGoals = onSnapshot(goalsQuery, snap => {
      setGoals(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[]);
    });

    return () => {
      unsubGoals();
    };
  }, [currentUser, currentPersona]);

  // Manually-added games are created directly as `stories` docs tagged 'game' (but not 'steam',
  // since they have no Steam appid and shouldn't be picked up by the steamMeta join in
  // KanbanBoardV2/KanbanCardV2). Steam-converted games are already represented via their `steam`
  // collection doc above, so we exclude anything tagged 'steam' here to avoid duplicates.
  useEffect(() => {
    if (!currentUser) return;
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('tags', 'array-contains', 'game')
    );
    const unsubscribe = onSnapshot(storiesQuery, (snapshot) => {
      const docs = snapshot.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((entry: any) => !(Array.isArray(entry.tags) && entry.tags.includes('steam'))) as ManualGameStory[];
      setManualGames(docs);
    }, (error) => {
      console.error('Failed to load manually-added games', error);
    });
    return unsubscribe;
  }, [currentUser]);

  const unifiedGames = useMemo<GameItem[]>(() => {
    const fromSteam: GameItem[] = games.map((game) => ({
      key: `steam:${game.id}`,
      sourceType: 'steam',
      name: game.name,
      platform: 'steam',
      appid: game.appid,
      playtimeMinutes: game.playtime_forever,
      rating: game.rating,
      converted: !!game.lastConvertedStoryId,
      storyId: game.lastConvertedStoryId,
      steamGame: game
    }));
    const fromManual: GameItem[] = manualGames.map((story) => ({
      key: `story:${story.id}`,
      sourceType: 'story',
      name: story.title,
      platform: story.metadata?.platform || 'other',
      artworkUrl: story.metadata?.artworkUrl,
      rating: story.metadata?.rating,
      converted: true,
      storyId: story.id
    }));
    return [...fromSteam, ...fromManual];
  }, [games, manualGames]);

  const filteredGames = useMemo(() => {
    return unifiedGames.filter(game => {
      const matchesSearch = !search || game.name.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'converted' ? game.converted : !game.converted);
      return matchesSearch && matchesStatus;
    });
  }, [unifiedGames, search, statusFilter]);

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
    if (selectedGame.lastConvertedStoryId) {
      window.alert('A story has already been generated for this item.');
      return;
    }
    if (!convertForm.goalId) {
      window.alert('Please choose a goal for this story.');
      return;
    }

    setSavingConversion(true);
    try {
      const dueDateMs = convertForm.targetDate ? new Date(convertForm.targetDate).getTime() : null;
      const sprintId = convertForm.sprintId || (dueDateMs ? findSprintForDate(sprints, dueDateMs)?.id || null : null);

      const storyRef = generateRef('story', []);

      const storyPayload = {
        ref: storyRef,
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
        personaKey: currentPersona,
        ownerPersona: currentPersona,
        ownerUid: currentUser.uid,
        orderIndex: Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        metadata: {
          steamAppId: selectedGame.appid,
          steamCover: buildCoverUrl(selectedGame.appid),
          platform: 'steam' as GamePlatform,
          rating: convertForm.rating
        }
      } as any;

      const storyDoc = await addDoc(collection(db, 'stories'), storyPayload);

      await updateDoc(doc(db, 'steam', selectedGame.id), {
        lastConvertedStoryId: storyDoc.id,
        lastConvertedAt: serverTimestamp(),
        completedAt: convertForm.targetDate ? new Date(convertForm.targetDate).getTime() : null,
        rating: convertForm.rating,
        persona: currentPersona,
      });

      setSelectedGame(null);
    } catch (error) {
      console.error('Failed to convert game to story', error);
      window.alert('Could not convert this game to a story.');
    } finally {
      setSavingConversion(false);
    }
  };

  const openAddModal = () => {
    setManualForm({ ...emptyManualForm, goalId: goals[0]?.id || '' });
    setItunesResults([]);
    setItunesError(null);
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setManualForm(emptyManualForm);
    setItunesResults([]);
    setItunesError(null);
  };

  // Free, keyless, CORS-enabled lookup against Apple's public iTunes Search API. Used to let Jim
  // pick a cover from the App Store catalogue instead of pasting a URL by hand. No API key, no
  // third-party account (deliberately avoiding IGDB/RAWG/SteamGridDB, which all require signup).
  const searchItunesArtwork = async () => {
    const term = manualForm.title.trim();
    if (!term) {
      setItunesError('Enter a game title first.');
      return;
    }
    setItunesLoading(true);
    setItunesError(null);
    try {
      const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&limit=5`);
      if (!response.ok) {
        throw new Error(`iTunes search failed with status ${response.status}`);
      }
      const payload = await response.json();
      const results: ITunesResult[] = Array.isArray(payload?.results) ? payload.results : [];
      setItunesResults(results);
      if (!results.length) {
        setItunesError('No App Store matches found. Paste an artwork URL manually instead.');
      }
    } catch (error) {
      console.error('iTunes artwork search failed', error);
      setItunesResults([]);
      setItunesError('Could not reach the App Store search. Paste an artwork URL manually instead.');
    } finally {
      setItunesLoading(false);
    }
  };

  const pickItunesArtwork = (result: ITunesResult) => {
    const url = result.artworkUrl512 || result.artworkUrl100;
    if (!url) return;
    setManualForm(prev => ({ ...prev, artworkUrl: url }));
  };

  const handleManualAdd = async () => {
    if (!currentUser) return;
    if (!manualForm.title.trim()) {
      window.alert('Please enter a game title.');
      return;
    }
    if (!manualForm.goalId) {
      window.alert('Please choose a goal for this story.');
      return;
    }

    setSavingManualAdd(true);
    try {
      const dueDateMs = manualForm.targetDate ? new Date(manualForm.targetDate).getTime() : null;
      const sprintId = manualForm.sprintId || (dueDateMs ? findSprintForDate(sprints, dueDateMs)?.id || null : null);

      const storyRef = generateRef('story', []);

      const storyPayload = {
        ref: storyRef,
        title: manualForm.title.trim(),
        description: `Play and complete ${manualForm.title.trim()}.`,
        goalId: manualForm.goalId,
        sprintId: sprintId || null,
        dueDate: dueDateMs || null,
        status: 0,
        priority: 2,
        points: 3,
        wipLimit: 3,
        // Manually-added games are tagged 'game' only (no 'steam'), so the Steam-specific
        // steamMeta join in KanbanBoardV2/KanbanCardV2 doesn't misfire on them, while
        // anything keying off the generic 'game' tag still picks them up.
        tags: ['game'],
        persona: currentPersona,
        personaKey: currentPersona,
        ownerPersona: currentPersona,
        ownerUid: currentUser.uid,
        orderIndex: Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        metadata: {
          platform: manualForm.platform,
          artworkUrl: manualForm.artworkUrl || null
        }
      } as any;

      await addDoc(collection(db, 'stories'), storyPayload);
      closeAddModal();
    } catch (error) {
      console.error('Failed to add manual game', error);
      window.alert('Could not add this game.');
    } finally {
      setSavingManualAdd(false);
    }
  };

  const renderRatingStars = (item: GameItem) => {
    const rating = item.rating ?? 0;
    const editable = item.sourceType === 'steam' && item.steamGame;
    return (
      <ButtonGroup size="sm">
        {[1,2,3,4,5].map((value) => (
          <Button
            key={value}
            variant={value <= rating ? 'warning' : 'outline-secondary'}
            disabled={!editable}
            onClick={editable ? () => handleRatingChange(item.steamGame as SteamGame, value) : undefined}
          >
            ★
          </Button>
        ))}
      </ButtonGroup>
    );
  };

  const renderCoverImage = (item: GameItem, style: React.CSSProperties) => {
    const src = resolveCoverUrl(item);
    if (src) {
      return <img src={src} alt={item.name} style={style} />;
    }
    return (
      <div
        className="d-flex align-items-center justify-content-center bg-light text-muted"
        style={style}
      >
        <Gamepad2 size={28} />
      </div>
    );
  };

  const renderPlatformBadge = (item: GameItem) => (
    <Badge bg="light" text="dark" className="border">{PLATFORM_LABELS[item.platform]}</Badge>
  );

  const renderListView = () => (
    <Table striped hover responsive size="sm" className="mb-0">
      <thead>
        <tr>
          <th>Game</th>
          <th>Platform</th>
          <th>Playtime</th>
          <th>Rating</th>
          <th>Status</th>
          <th style={{ width: 160 }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {filteredGames.map((game) => {
          return (
            <tr key={game.key}>
              <td>
                <div className="d-flex align-items-center gap-2">
                  {renderCoverImage(game, { width: 80, height: 30, objectFit: 'cover', borderRadius: 4 })}
                  <div>
                    <div className="fw-semibold">{game.name}</div>
                    {game.appid != null && <div className="text-muted small">AppID: {game.appid}</div>}
                  </div>
                </div>
              </td>
              <td>{renderPlatformBadge(game)}</td>
              <td>{game.playtimeMinutes != null ? `${(game.playtimeMinutes / 60).toFixed(1)} hrs` : '—'}</td>
              <td>{renderRatingStars(game)}</td>
              <td>{game.converted ? <Badge bg="success">Story Linked</Badge> : <Badge bg="secondary">Backlog</Badge>}</td>
              <td>
                <div className="d-flex gap-2">
                  {!game.converted && game.sourceType === 'steam' && game.steamGame && (
                    <Button size="sm" variant="outline-primary" onClick={() => openConvertModal(game.steamGame as SteamGame)}>Convert to Story</Button>
                  )}
                  {game.converted && game.storyId && (
                    <Button size="sm" variant="outline-secondary" href={`/stories/${game.storyId}`}>View story</Button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
        {filteredGames.length === 0 && (
          <tr>
            <td colSpan={6} className="text-center text-muted py-4">No games match the current filters.</td>
          </tr>
        )}
      </tbody>
    </Table>
  );

  const renderCardView = () => (
    <Row xs={1} md={2} lg={3} className="g-3">
      {filteredGames.map((game) => {
        return (
          <Col key={game.key}>
            <Card className="h-100 shadow-sm">
              <div style={{ height: 180, overflow: 'hidden', borderTopLeftRadius: '0.5rem', borderTopRightRadius: '0.5rem' }}>
                {renderCoverImage(game, { width: '100%', height: '100%', objectFit: 'cover' })}
              </div>
              <Card.Body className="d-flex flex-column">
                <div className="d-flex align-items-start justify-content-between gap-2">
                  <Card.Title className="mb-1">{game.name}</Card.Title>
                  {renderPlatformBadge(game)}
                </div>
                <Card.Subtitle className="mb-2 text-muted">
                  {game.playtimeMinutes != null ? `${(game.playtimeMinutes / 60).toFixed(1)} hrs played` : ' '}
                </Card.Subtitle>
                {game.storyId && (
                  <div className="text-muted small mb-2">
                    Story ID: <code>{game.storyId.slice(-8)}</code>
                  </div>
                )}
                <div className="mb-3">{renderRatingStars(game)}</div>
                <div className="mt-auto d-flex justify-content-between align-items-center">
                  {game.converted ? <Badge bg="success">Story Linked</Badge> : <Badge bg="secondary">Backlog</Badge>}
                  {game.converted && game.storyId && (
                    <Button size="sm" variant="outline-secondary" href={`/stories/${game.storyId}`}>View story</Button>
                  )}
                  {!game.converted && game.sourceType === 'steam' && game.steamGame && (
                    <Button size="sm" variant="outline-primary" onClick={() => openConvertModal(game.steamGame as SteamGame)}>Convert</Button>
                  )}
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
          <Button size="sm" variant="primary" onClick={openAddModal}>+ Add game</Button>
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

      <Modal show={showAddModal} onHide={closeAddModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Add Game</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g. Monument Valley"
                value={manualForm.title}
                onChange={(e) => setManualForm(prev => ({ ...prev, title: e.target.value }))}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Platform</Form.Label>
              <Form.Select
                value={manualForm.platform}
                onChange={(e) => setManualForm(prev => ({ ...prev, platform: e.target.value as GamePlatform }))}
              >
                {(Object.keys(PLATFORM_LABELS) as GamePlatform[]).filter(p => p !== 'steam').map(platform => (
                  <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}</option>
                ))}
              </Form.Select>
              <Form.Text muted>Use the Steam sync for Steam titles — this form is for everything else.</Form.Text>
            </Form.Group>

            <Form.Group className="mb-2">
              <Form.Label>Artwork</Form.Label>
              <div className="d-flex gap-2 mb-2">
                <Button size="sm" variant="outline-secondary" onClick={searchItunesArtwork} disabled={itunesLoading || !manualForm.title.trim()}>
                  {itunesLoading ? <><Spinner animation="border" size="sm" className="me-1" />Searching…</> : 'Search App Store artwork'}
                </Button>
              </div>
              {itunesError && <div className="text-muted small mb-2">{itunesError}</div>}
              {itunesResults.length > 0 && (
                <div className="d-flex flex-wrap gap-2 mb-3">
                  {itunesResults.map(result => {
                    const thumb = result.artworkUrl100 || result.artworkUrl512;
                    const selected = manualForm.artworkUrl === (result.artworkUrl512 || result.artworkUrl100);
                    return (
                      <div
                        key={result.trackId}
                        onClick={() => pickItunesArtwork(result)}
                        style={{
                          cursor: 'pointer',
                          border: selected ? '2px solid var(--bs-primary)' : '1px solid var(--bs-border-color)',
                          borderRadius: 6,
                          padding: 4,
                          width: 88,
                          textAlign: 'center'
                        }}
                        title={result.trackName}
                      >
                        {thumb && <img src={thumb} alt={result.trackName} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 4 }} />}
                        <div className="small text-truncate mt-1">{result.trackName}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Form.Control
                type="text"
                placeholder="Or paste an artwork URL"
                value={manualForm.artworkUrl}
                onChange={(e) => setManualForm(prev => ({ ...prev, artworkUrl: e.target.value }))}
              />
              {manualForm.artworkUrl && (
                <div className="mt-2">
                  <img src={manualForm.artworkUrl} alt="Selected artwork" style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 6 }} />
                </div>
              )}
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Goal</Form.Label>
              <Form.Select
                value={manualForm.goalId}
                onChange={(e) => setManualForm(prev => ({ ...prev, goalId: e.target.value }))}
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
                value={manualForm.sprintId || ''}
                onChange={(e) => setManualForm(prev => ({ ...prev, sprintId: e.target.value || null }))}
              >
                <option value="">No sprint</option>
                {sprints.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Target date (optional)</Form.Label>
              <Form.Control
                type="date"
                value={manualForm.targetDate}
                onChange={(e) => setManualForm(prev => ({ ...prev, targetDate: e.target.value }))}
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={closeAddModal}>Cancel</Button>
          <Button variant="primary" onClick={handleManualAdd} disabled={savingManualAdd}>
            {savingManualAdd ? 'Adding…' : 'Add game'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
};

export default GamesBacklog;
