import React from 'react';
import { Badge } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { spacing } from '../../utils/spacing';
import { typography } from '../../utils/typography';

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    breadcrumbs?: { label: string; href?: string }[];
    actions?: React.ReactNode;
    badge?: {
        label: string;
        variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'secondary';
    };
}

export const PageHeader: React.FC<PageHeaderProps> = ({
    title,
    subtitle,
    breadcrumbs,
    actions,
    badge,
}) => {
    const navigate = useNavigate();

    return (
        <div style={{
            marginBottom: spacing[8],
            paddingBottom: spacing[6],
            borderBottom: '1px solid var(--line)',
        }}>
            {breadcrumbs && breadcrumbs.length > 0 && (
                <nav style={{
                    marginBottom: spacing[3],
                    fontSize: '13px',
                    color: 'var(--muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: spacing[2],
                    flexWrap: 'wrap',
                }}>
                    {breadcrumbs.map((crumb, i) => (
                        <React.Fragment key={i}>
                            {crumb.href ? (
                                <a
                                    href={crumb.href}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        navigate(crumb.href!);
                                    }}
                                    style={{
                                        color: 'var(--muted)',
                                        textDecoration: 'none',
                                        transition: 'color 0.15s',
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--brand)'}
                                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
                                >
                                    {crumb.label}
                                </a>
                            ) : (
                                <span style={{ color: 'var(--text)', fontWeight: '500' }}>
                                    {crumb.label}
                                </span>
                            )}
                            {i < breadcrumbs.length - 1 && <span>/</span>}
                        </React.Fragment>
                    ))}
                </nav>
            )}

            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: spacing[6],
                flexWrap: 'wrap',
            }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: spacing[3],
                        marginBottom: spacing[2],
                        flexWrap: 'wrap',
                    }}>
                        <h1 style={{
                            margin: 0,
                            ...typography.h1,
                        }}>
                            {title}
                        </h1>
                        {badge && (
                            <Badge
                                bg={badge.variant || 'primary'}
                                style={{
                                    fontSize: '12px',
                                    padding: '6px 12px',
                                    fontWeight: '600',
                                }}
                            >
                                {badge.label}
                            </Badge>
                        )}
                    </div>

                    {subtitle && (
                        <p style={{
                            margin: 0,
                            ...typography.body,
                            color: 'var(--muted)',
                        }}>
                            {subtitle}
                        </p>
                    )}
                </div>

                {actions && (
                    <div style={{
                        display: 'flex',
                        gap: spacing[3],
                        flexShrink: 0,
                        flexWrap: 'wrap',
                    }}>
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PageHeader;
