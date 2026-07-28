import React, { useEffect, useRef, useState } from 'react';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { themeVars } from '../utils/themeVars';

interface KanbanColumnV2Props {
    status: string;
    title: string;
    color: string;
    children: React.ReactNode;
    /** Registers this column's scrollable body element with the parent board, so the
     * board can scroll all columns together in lockstep when the mouse isn't directly
     * over a specific column. Hovering the column itself still scrolls it natively. */
    registerScrollEl?: (status: string, el: HTMLDivElement | null) => void;
    /** Unique key for scroll registration. Defaults to `status`; the swimlane layout has
     * three columns per goal so it needs `${goalId}:${status}` to avoid collisions. */
    scrollKey?: string;
    /** Swimlane cells must not own a vertical scroller — the page owns it, so a band is as
     * tall as its fullest column. Only the flat board's columns scroll independently. */
    scrolls?: boolean;
    /** Header is redundant inside a swimlane after the first band. */
    showHeader?: boolean;
}

const KanbanColumnV2: React.FC<KanbanColumnV2Props> = ({
    status, title, color, children, registerScrollEl,
    scrollKey, scrolls = true, showHeader = true,
}) => {
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

    const registrationKey = scrollKey ?? status;
    useEffect(() => {
        if (!scrolls) return undefined;
        registerScrollEl?.(registrationKey, ref.current);
        return () => registerScrollEl?.(registrationKey, null);
    }, [registrationKey, scrolls, registerScrollEl]);

    return (
        <div className="kanban-column" style={{ flex: 1, minWidth: scrolls ? '300px' : 0, display: 'flex', flexDirection: 'column', height: scrolls ? '100%' : undefined }}>
            {showHeader && (
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
                    justifyContent: 'space-between',
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
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
            )}

            <div
                ref={ref}
                data-kanban-column-body={scrolls ? 'true' : undefined}
                className={`kanban-column-body${isDraggedOver ? ' is-dragged-over' : ''}`}
                style={{
                    flex: 1,
                    padding: '8px',
                    backgroundColor: isDraggedOver ? 'var(--notion-hover)' : 'var(--bg-subtle)',
                    borderRadius: '8px',
                    overflowY: scrolls ? 'auto' : 'visible',
                    minHeight: scrolls ? '200px' : '80px',
                    transition: 'background-color 0.2s ease'
                }}
            >
                {children}
            </div>
        </div>
    );
};

export default KanbanColumnV2;
