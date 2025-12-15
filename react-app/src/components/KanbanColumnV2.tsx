import React, { useEffect, useRef, useState } from 'react';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { themeVars } from '../utils/themeVars';

interface KanbanColumnV2Props {
    status: string;
    title: string;
    color: string;
    children: React.ReactNode;
}

const KanbanColumnV2: React.FC<KanbanColumnV2Props> = ({ status, title, color, children }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [isDraggedOver, setIsDraggedOver] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        return dropTargetForElements({
            element: el,
            getData: () => ({ status }),
            onDragEnter: () => setIsDraggedOver(true),
            onDragLeave: () => setIsDraggedOver(false),
            onDrop: () => setIsDraggedOver(false),
        });
    }, [status]);

    return (
        <div className="kanban-column" style={{ flex: 1, minWidth: '300px', display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div
                className="kanban-column-header"
                style={{
                    padding: '12px',
                    borderBottom: `2px solid ${color}`,
                    backgroundColor: 'var(--card)',
                    borderTopLeftRadius: '8px',
                    borderTopRightRadius: '8px',
                    marginBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}
            >
                <h5 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{title}</h5>
                <span style={{
                    backgroundColor: color,
                    color: '#fff',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 600
                }}>
                    {React.Children.count(children)}
                </span>
            </div>

            <div
                ref={ref}
                className={`kanban-column-body${isDraggedOver ? ' is-dragged-over' : ''}`}
                style={{
                    flex: 1,
                    padding: '8px',
                    backgroundColor: isDraggedOver ? 'var(--notion-hover)' : 'var(--bg-subtle)',
                    borderRadius: '8px',
                    overflowY: 'auto',
                    minHeight: '200px',
                    transition: 'background-color 0.2s ease'
                }}
            >
                {children}
            </div>
        </div>
    );
};

export default KanbanColumnV2;
