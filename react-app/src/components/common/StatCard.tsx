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
    compact?: boolean;
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
    compact = false,
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
        transform: isHovered ? (compact ? 'translateY(-2px)' : 'translateY(-4px)') : 'translateY(0)',
        transition: `all 0.2s cubic-bezier(0.4, 0, 0.2, 1), ${elevationTransition}`,
        cursor: onClick ? 'pointer' : 'default',
        height: '100%',
    };

    const iconStyles: React.CSSProperties = {
        width: compact ? '28px' : '40px',
        height: compact ? '28px' : '40px',
        borderRadius: compact ? '7px' : '10px',
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
            <Card.Body style={{ padding: compact ? spacing[3] : spacing[6] }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: compact ? spacing[2] : spacing[4]
                }}>
                    {Icon && (
                        <div style={iconStyles}>
                            <Icon size={compact ? 16 : 20} />
                        </div>
                    )}
                    {trend && (
                        <Badge
                            bg={trend.direction === 'up' ? 'success' : 'danger'}
                            style={{
                                fontSize: compact ? '11px' : '12px',
                                fontWeight: '600',
                                padding: compact ? '2px 6px' : '4px 8px',
                            }}
                        >
                            {trend.direction === 'up' ? '↑' : '↓'} {trend.value}%
                        </Badge>
                    )}
                </div>

                <div style={{
                    fontSize: compact ? '22px' : '36px',
                    fontWeight: '700',
                    lineHeight: '1.1',
                    color: 'var(--text)',
                    marginBottom: compact ? 4 : spacing[2],
                }}>
                    {value}
                </div>

                <div style={{
                    fontSize: compact ? '10px' : '13px',
                    fontWeight: '500',
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    letterSpacing: compact ? '0.35px' : '0.5px',
                }}>
                    {label}
                </div>

                {trend?.label && (
                    <div style={{
                        fontSize: compact ? '10px' : '12px',
                        color: 'var(--muted)',
                        marginTop: compact ? 4 : spacing[2],
                    }}>
                        {trend.label}
                    </div>
                )}
            </Card.Body>
        </Card>
    );
};

export default StatCard;
