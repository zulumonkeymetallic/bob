import React from 'react';
import { Card } from 'react-bootstrap';
import { spacing } from '../../utils/spacing';
import { elevation } from '../../utils/elevation';

interface SkeletonProps {
    width?: string | number;
    height?: string | number;
    borderRadius?: string;
    marginBottom?: string;
    style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({
    width = '100%',
    height = '20px',
    borderRadius = '4px',
    marginBottom,
    style,
}) => {
    return (
        <div
            className="skeleton"
            style={{
                width,
                height,
                borderRadius,
                marginBottom,
                ...style,
            }}
        />
    );
};

export const SkeletonCard: React.FC<{ rows?: number }> = ({ rows = 3 }) => (
    <Card style={{
        border: 'none',
        boxShadow: elevation.base,
        borderRadius: '12px'
    }}>
        <Card.Body style={{ padding: spacing[6] }}>
            <Skeleton height="40px" width="60%" marginBottom={spacing[3]} />
            {Array.from({ length: rows }).map((_, i) => (
                <Skeleton
                    key={i}
                    height="20px"
                    width={i === rows - 1 ? '40%' : '100%'}
                    marginBottom={i < rows - 1 ? spacing[2] : undefined}
                />
            ))}
        </Card.Body>
    </Card>
);

export const SkeletonTable: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
    <div>
        {Array.from({ length: rows }).map((_, i) => (
            <div
                key={i}
                style={{
                    padding: spacing[4],
                    borderBottom: '1px solid var(--line)'
                }}
            >
                <Skeleton height="20px" marginBottom={spacing[2]} />
                <Skeleton height="16px" width="70%" />
            </div>
        ))}
    </div>
);

export const SkeletonStatCard: React.FC = () => (
    <Card style={{
        border: 'none',
        boxShadow: elevation.base,
        borderRadius: '12px',
        height: '100%',
    }}>
        <Card.Body style={{ padding: spacing[6] }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: spacing[4],
            }}>
                <Skeleton width="40px" height="40px" borderRadius="10px" />
                <Skeleton width="60px" height="24px" borderRadius="12px" />
            </div>
            <Skeleton height="36px" width="80px" marginBottom={spacing[2]} />
            <Skeleton height="13px" width="120px" />
        </Card.Body>
    </Card>
);

export default Skeleton;
