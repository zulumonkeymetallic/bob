import React from 'react';
import { Card } from 'react-bootstrap';
import { useTheme } from '../../contexts/ThemeContext';

interface PremiumCardProps {
    children: React.ReactNode;
    title?: string;
    subtitle?: string;
    icon?: React.ElementType;
    className?: string;
    action?: React.ReactNode;
    height?: string | number;
}

export const PremiumCard: React.FC<PremiumCardProps> = ({ children, title, subtitle, icon: Icon, className, action, height }) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    return (
        <Card className={`h-100 border-0 ${className}`}
            style={{
                backgroundColor: isDark ? '#27293d' : '#ffffff',
                color: isDark ? '#ffffff' : '#2c3e50',
                borderRadius: '16px',
                boxShadow: isDark ? '0 4px 20px 0 rgba(0,0,0,0.4)' : '0 4px 20px 0 rgba(0,0,0,0.05)',
                transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
                overflow: 'hidden'
            }}>
            <Card.Body className="p-4 d-flex flex-column">
                {(title || Icon || action) && (
                    <div className="d-flex justify-content-between align-items-start mb-4">
                        <div>
                            {title && <h5 className="fw-bold mb-1" style={{ fontSize: '1.1rem', letterSpacing: '0.5px' }}>{title}</h5>}
                            {subtitle && <p className="text-muted small mb-0" style={{ fontSize: '0.85rem' }}>{subtitle}</p>}
                        </div>
                        <div className="d-flex align-items-center gap-2">
                            {action}
                            {Icon && <div className="p-2 rounded-circle" style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
                                <Icon size={18} className={isDark ? 'text-white' : 'text-dark'} style={{ opacity: 0.8 }} />
                            </div>}
                        </div>
                    </div>
                )}
                <div style={{ flex: 1, height: height || 'auto', minHeight: 0 }}>
                    {children}
                </div>
            </Card.Body>
        </Card>
    );
};
