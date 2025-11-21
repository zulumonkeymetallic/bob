import React, { useState } from 'react';
import { Card, Badge } from 'react-bootstrap';
import { LucideIcon } from 'lucide-react';
import { colors } from '../../utils/colors';
import { spacing } from '../../utils/spacing';
import { elevation, elevationTransitions, elevationTransition } from '../../utils/elevation';
import { typography } from '../../utils/typography';

interface StatCardProps {
    label: string;
    value: string | number;
    icon?: LucideIcon;
    iconColor?: string;
    trend?: {
        value: number;
        direction: 'up' | 'down';
        label?: string;
    };
    onClick?: () => void;
    variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

export const StatCard: React.FC<StatCardProps> = ({
    label,
    value,
    icon: Icon,
    iconColor,
    trend,
    onClick,
    variant = 'default',
}) => {
    const [isHovered, setIsHovered] = useState(false);

    const variantColors: Record<string, string> = {
        default: colors.neutral[600],
        success: colors.success.primary,
        warning: colors.warning.primary,
        danger: colors.danger.primary,
        info: colors.info.primary,
    };

    const cardStyles: React.CSSProperties = {
        border: 'none',
        borderRadius: '12px',
        boxShadow: isHovered ? elevationTransitions.card.hover : elevationTransitions.card.rest,
        transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
        transition: `all 0.2s cubic-bezier(0.4, 0, 0.2, 1), ${elevationTransition}`,
        cursor: onClick ? 'pointer' : 'default',
        height: '100%',
    };

    const iconStyles: React.CSSProperties = {
        width: '40px',
        height: '40px',
        borderRadius: '10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: `${iconColor || variantColors[variant]}15`,
        color: iconColor || variantColors[variant],
    };

    return (
        <Card
            style={cardStyles}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={onClick}
        >
            <Card.Body style={{ padding: spacing[6] }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: spacing[4]
                }}>
                    {Icon && (
                        <div style={iconStyles}>
                            <Icon size={20} />
                        </div>
                    )}
                    {trend && (
                        <Badge
                            bg={trend.direction === 'up' ? 'success' : 'danger'}
                            style={{
                                fontSize: '12px',
                                fontWeight: '600',
                                padding: '4px 8px',
                            }}
                        >
                            {trend.direction === 'up' ? '↑' : '↓'} {trend.value}%
                        </Badge>
                    )}
                </div>

                <div style={{
                    fontSize: '36px',
                    fontWeight: '700',
                    lineHeight: '1.1',
                    color: 'var(--text)',
                    marginBottom: spacing[2],
                }}>
                    {value}
                </div>

                <div style={{
                    fontSize: '13px',
                    fontWeight: '500',
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                }}>
                    {label}
                </div>

                {trend?.label && (
                    <div style={{
                        fontSize: '12px',
                        color: 'var(--muted)',
                        marginTop: spacing[2],
                    }}>
                        {trend.label}
                    </div>
                )}
            </Card.Body>
        </Card>
    );
};

export default StatCard;
