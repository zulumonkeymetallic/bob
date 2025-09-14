import React, { useEffect, useMemo, useState } from 'react';
import { Card, Form, Row, Col, Badge } from 'react-bootstrap';

interface RRuleEditorProps {
  value?: string;
  dtstart?: string; // datetime-local string used only for preview text
  onChange: (rrule: string) => void;
}

type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY';

const WEEK_DAYS = [
  { label: 'Mon', code: 'MO', val: 1 },
  { label: 'Tue', code: 'TU', val: 2 },
  { label: 'Wed', code: 'WE', val: 3 },
  { label: 'Thu', code: 'TH', val: 4 },
  { label: 'Fri', code: 'FR', val: 5 },
  { label: 'Sat', code: 'SA', val: 6 },
  { label: 'Sun', code: 'SU', val: 0 },
];

function parseExisting(rrule?: string) {
  const result: { freq: Freq; interval: number; byday: string[]; bymonthday?: number } = {
    freq: 'WEEKLY',
    interval: 1,
    byday: ['MO']
  };
  if (!rrule) return result;
  try {
    const text = String(rrule).toUpperCase();
    const parts = text.replace(/^RRULE:/, '').split(';').map(p => p.trim());
    for (const p of parts) {
      const [k, v] = p.split('=');
      if (k === 'FREQ' && (v === 'DAILY' || v === 'WEEKLY' || v === 'MONTHLY')) result.freq = v;
      else if (k === 'INTERVAL') result.interval = Math.max(1, parseInt(v || '1', 10) || 1);
      else if (k === 'BYDAY' && v) result.byday = v.split(',').filter(Boolean);
      else if (k === 'BYMONTHDAY' && v) result.bymonthday = Math.min(31, Math.max(1, parseInt(v, 10) || 1));
    }
  } catch {}
  return result;
}

const RRuleEditor: React.FC<RRuleEditorProps> = ({ value, dtstart, onChange }) => {
  const initial = useMemo(() => parseExisting(value), [value]);
  const [freq, setFreq] = useState<Freq>(initial.freq);
  const [interval, setInterval] = useState<number>(initial.interval);
  const [byday, setByday] = useState<string[]>(initial.byday);
  const [bymonthday, setBymonthday] = useState<number>(initial.bymonthday || new Date().getDate());

  useEffect(() => {
    const parts: string[] = [`FREQ=${freq}`, `INTERVAL=${Math.max(1, interval || 1)}`];
    if (freq === 'WEEKLY' && byday.length) parts.push(`BYDAY=${byday.join(',')}`);
    if (freq === 'MONTHLY' && bymonthday) parts.push(`BYMONTHDAY=${bymonthday}`);
    onChange(`RRULE:${parts.join(';')}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freq, interval, byday.join(','), bymonthday]);

  return (
    <Card className="mt-2" style={{ background: 'var(--notion-hover)', border: '1px solid var(--notion-border)' }}>
      <Card.Body>
        <Row className="g-3 align-items-end">
          <Col md={3}>
            <Form.Label>Frequency</Form.Label>
            <Form.Select value={freq} onChange={e => setFreq(e.target.value as Freq)}>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </Form.Select>
          </Col>
          <Col md={3}>
            <Form.Label>Interval</Form.Label>
            <Form.Control type="number" min={1} value={interval} onChange={e => setInterval(parseInt(e.target.value || '1', 10))} />
            <div className="form-text">Every N {freq.toLowerCase()}</div>
          </Col>
          {freq === 'WEEKLY' && (
            <Col md={6}>
              <Form.Label>Days</Form.Label>
              <div className="d-flex flex-wrap gap-2">
                {WEEK_DAYS.map(d => (
                  <Badge
                    key={d.code}
                    bg={byday.includes(d.code) ? 'primary' : 'secondary'}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setByday(prev => prev.includes(d.code) ? prev.filter(x => x !== d.code) : [...prev, d.code]);
                    }}
                  >
                    {d.label}
                  </Badge>
                ))}
              </div>
            </Col>
          )}
          {freq === 'MONTHLY' && (
            <Col md={3}>
              <Form.Label>Day of Month</Form.Label>
              <Form.Control type="number" min={1} max={31} value={bymonthday} onChange={e => setBymonthday(Math.min(31, Math.max(1, parseInt(e.target.value || '1', 10))))} />
            </Col>
          )}
        </Row>
      </Card.Body>
    </Card>
  );
};

export default RRuleEditor;

