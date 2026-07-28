/**
 * The List / Detail switch the Daily Plan already uses on mobile, extracted so Goals,
 * Stories and Tasks present the identical control rather than each page inventing one.
 * The choice persists per surface via `storageKey`.
 */

import React from 'react';
import { Button } from 'react-bootstrap';
import type { MobileEntityViewType } from './MobileEntityList';

interface MobileViewToggleProps {
    value: MobileEntityViewType;
    onChange: (next: MobileEntityViewType) => void;
    storageKey?: string;
}

export const readStoredMobileView = (
    storageKey: string,
    fallback: MobileEntityViewType = 'list',
): MobileEntityViewType => {
    try {
        const stored = localStorage.getItem(storageKey);
        if (stored === 'list' || stored === 'detail') return stored;
    } catch { /* noop */ }
    return fallback;
};

const MobileViewToggle: React.FC<MobileViewToggleProps> = ({ value, onChange, storageKey }) => {
    const select = (next: MobileEntityViewType) => {
        onChange(next);
        if (storageKey) {
            try { localStorage.setItem(storageKey, next); } catch { /* noop */ }
        }
    };

    return (
        <div className="d-flex gap-1" style={{ flexShrink: 0 }}>
            <Button
                size="sm"
                variant={value === 'list' ? 'secondary' : 'outline-secondary'}
                onClick={() => select('list')}
                style={{ whiteSpace: 'nowrap' }}
            >
                List
            </Button>
            <Button
                size="sm"
                variant={value === 'detail' ? 'secondary' : 'outline-secondary'}
                onClick={() => select('detail')}
                style={{ whiteSpace: 'nowrap' }}
            >
                Detail
            </Button>
        </div>
    );
};

export default MobileViewToggle;
