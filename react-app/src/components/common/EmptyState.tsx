import React from 'react';
import { Button } from 'react-bootstrap';
import { LucideIcon } from 'lucide-react';
import { spacing } from '../../utils/spacing';
import { typography } from '../../utils/typography';

interface EmptyStateProps {
    icon: LucideIcon;
    title: string;
    description: string;
    action?: {
        label: string;
        onClick: () => void;
        variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info';
    };
    illustration?: string; // URL to illustration image
}

export const EmptyState: React.FC<EmptyStateProps> = ({
    icon: Icon,
    title,
    description,
    action,
    illustration,
}) => (
    <div style={{
        textAlign: 'center',
        padding: `${spacing[16]} ${spacing[10]}`,
        maxWidth: '480px',
        margin: '0 auto',
    }}>
        {illustration ? (
            <img
                src={illustration}
                alt=""
                style={{
                    width: '200px',
                    height: 'auto',
                    marginBottom: spacing[6],
                    opacity: 0.8,
                }}
            />
        ) : (
            <div style={{
                width: '80px',
                height: '80px',
                margin: `0 auto ${spacing[6]}`,
                borderRadius: '20px',
                backgroundColor: 'var(--card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--muted)',
            }}>
                <Icon size={40} />
            </div>
        )}

        <h3 style={{
            margin: `0 0 ${spacing[3]} 0`,
            ...typography.h3,
            color: 'var(--text)',
        }}>
            {title}
        </h3>

        <p style={{
            margin: `0 0 ${spacing[8]} 0`,
            ...typography.body,
            color: 'var(--muted)',
        }}>
            {description}
        </p>

        {action && (
            <Button
                variant={action.variant || 'primary'}
                onClick={action.onClick}
                style={{
                    fontSize: '15px',
                    fontWeight: '600',
                    padding: `${spacing[3]} ${spacing[8]}`,
                    borderRadius: '8px',
                }}
            >
                {action.label}
            </Button>
        )}
    </div>
);

export default EmptyState;
