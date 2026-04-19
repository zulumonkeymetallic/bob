import React from 'react';
import { Badge } from 'react-bootstrap';

interface StoryBlockProps {
    event: {
        title: string;
        theme?: string;
        subtheme?: string;
        isStarted?: boolean;
        conflictStatus?: string;
        [key: string]: any;
    };
}

const StoryBlock: React.FC<StoryBlockProps> = ({ event }) => {
    const getThemeColor = (theme?: string) => {
        switch (theme) {
            case 'Health': return '#dc3545'; // danger
            case 'Growth': return '#0d6efd'; // primary
            case 'Wealth': return '#198754'; // success
            case 'Tribe': return '#0dcaf0'; // info
            case 'Home': return '#ffc107'; // warning
            default: return '#6c757d'; // secondary
        }
    };

    const borderColor = getThemeColor(event.theme);
    const bgColor = event.isStarted ? '#e7f1ff' : 'white';

    return (
        <div style={{
            height: '100%',
            borderLeft: `4px solid ${borderColor}`,
            backgroundColor: bgColor,
            padding: '2px 4px',
            fontSize: '0.75rem',
            overflow: 'hidden',
            color: '#000',
            display: 'flex',
            flexDirection: 'column'
        }}>
            <div style={{ fontWeight: 600, lineHeight: 1.2 }}>
                {event.conflictStatus === 'requires_review' && <span style={{ color: 'red', marginRight: '4px' }}>⚠</span>}
                {event.title}
            </div>
            {event.subtheme && <div style={{ fontSize: '0.7rem', opacity: 0.8 }}>{event.subtheme}</div>}
        </div>
    );
};

export default StoryBlock;
