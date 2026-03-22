/**
 * AiCoachPhotoGallery
 *
 * Real-time grid of body-composition progress photos.
 * Reads coach_photos/{uid}/photos sub-collection, ordered by capturedAt desc.
 * Displays BF% trend using recharts LineChart (already used in WorkoutsDashboard).
 */

import React, { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { CoachPhoto } from '../../types/CoachTypes';

interface Props {
  onUploadClick: () => void;
}

export const AiCoachPhotoGallery: React.FC<Props> = ({ onUploadClick }) => {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;
  const [photos, setPhotos] = useState<(CoachPhoto & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'coach_photos', uid, 'photos'),
      orderBy('capturedAt', 'desc')
    );
    const unsub = onSnapshot(q, snap => {
      setPhotos(snap.docs.map(d => ({ id: d.id, ...(d.data() as CoachPhoto) })));
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  // Prepare trend data (oldest → newest for chart)
  const trendData = [...photos]
    .filter(p => p.estimatedBfPct !== null && p.capturedAt)
    .reverse()
    .map(p => ({
      date: p.capturedAt?.toDate
        ? p.capturedAt.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : '—',
      bf: p.estimatedBfPct,
    }));

  if (loading) {
    return <div className="text-sm text-gray-500 py-4">Loading photos...</div>;
  }

  return (
    <div className="space-y-4">
      {/* BF% Trend chart */}
      {trendData.length >= 2 && (
        <div className="bg-gray-800/50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-300 mb-3">Body Fat % Trend</h4>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={trendData}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                unit="%"
              />
              <Tooltip
                formatter={(v: number) => [`${v}%`, 'Est. BF%']}
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6 }}
                labelStyle={{ color: '#d1d5db' }}
                itemStyle={{ color: '#34d399' }}
              />
              <Line
                type="monotone"
                dataKey="bf"
                stroke="#34d399"
                strokeWidth={2}
                dot={{ r: 3, fill: '#34d399' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Photo grid */}
      {photos.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          <div className="text-3xl mb-2">📷</div>
          <p>No progress photos yet.</p>
          <button
            onClick={onUploadClick}
            className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
          >
            Upload first photo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map(photo => (
            <div key={photo.id} className="bg-gray-800/60 rounded-lg overflow-hidden border border-gray-700/50">
              {photo.downloadUrl ? (
                <img
                  src={photo.downloadUrl}
                  alt="Progress photo"
                  className="w-full aspect-[3/4] object-cover"
                />
              ) : (
                <div className="w-full aspect-[3/4] bg-gray-700/50 flex items-center justify-center text-gray-500 text-xs">
                  {photo.analysisStatus === 'pending' ? 'Analysing...' : 'No image'}
                </div>
              )}
              <div className="px-2 py-2 space-y-0.5">
                <div className="text-xs text-gray-400">
                  {photo.capturedAt?.toDate
                    ? photo.capturedAt.toDate().toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric'
                      })
                    : '—'}
                </div>
                {photo.estimatedBfPct !== null ? (
                  <div className="text-sm font-semibold text-emerald-400">
                    ~{photo.estimatedBfPct}% BF
                  </div>
                ) : photo.analysisStatus === 'pending' ? (
                  <div className="text-xs text-yellow-400">Analysing…</div>
                ) : photo.analysisStatus === 'error' ? (
                  <div className="text-xs text-red-400">Analysis failed</div>
                ) : null}
                {photo.observations && (
                  <div className="text-xs text-gray-500 leading-tight line-clamp-2">
                    {photo.observations}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AiCoachPhotoGallery;
