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
    registerScrollEl?: (key: string, el: HTMLDivElement | null) => void;
    /** Unique key for scroll registration. Defaults to `status`; goal swimlanes pass
     * `${laneKey}:${status}` so one lane's column doesn't evict another's. */
    scrollKey?: string;
    /** Swimlane mode: the column sits inside a goal lane, so it sizes to its content
     * (capped) instead of filling the board's full height. */
    laneMode?: boolean;
}

const KanbanColumnV2: React.FC<KanbanColumnV2Props> = ({
    status, title, color, children, registerScrollEl, scrollKey, laneMode = false,
}) => {
    const ref = useRef<HTMLDivElement>(null);
    const [isDraggedOver, setIsDraggedOver] = useState(false);
    const registrationKey = scrollKey || status;

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

    useEffect(() => {
        registerScrollEl?.(registrationKey, ref.current);
        return () => registerScrollEl?.(registrationKey, null);
    }, [registrationKey, registerScrollEl]);

    return (
        <div
            className="kanban-column"
            style={{
                flex: 1,
                minWidth: laneMode ? '260px' : '300px',
                display: 'flex',
                flexDirection: 'column',
                height: laneMode ? 'auto' : '100%',
            }}
        >
            <div
                className="kanban-column-header"
                style={{
                    padding: laneMode ? '6px 10px' : '12px',
                    borderBottom: `2px solid ${color}`,
                    backgroundColor: 'var(--card)',
                    borderTopLeftRadius: '8px',
                    borderTopRightRadius: '8px',
                    marginBottom: laneMode ? '6px' : '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    position: laneMode ? 'static' : 'sticky',
                    top: 0,
                    zIndex: 2,
                }}
            >
                <h5 style={{ margin: 0, fontSize: laneMode ? '12px' : '16px', fontWeight: 600, color: laneMode ? (themeVars.muted as string) : undefined, textTransform: laneMode ? 'uppercase' : 'none', letterSpacing: laneMode ? '0.04em' : undefined }}>{title}</h5>
                <span style={{
                    backgroundColor: color,
                    color: '#fff',
                    padding: laneMode ? '1px 7px' : '2px 8px',
                    borderRadius: '12px',
                    fontSize: laneMode ? '11px' : '12px',
                    fontWeight: 600
                }}>
                    {React.Children.count(children)}
                </span>
            </div>

            <div
                ref={ref}
                data-kanban-column-body="true"
                className={`kanban-column-body${isDraggedOver ? ' is-dragged-over' : ''}`}
                style={{
                    flex: laneMode ? undefined : 1,
                    padding: '8px',
                    backgroundColor: isDraggedOver ? 'var(--notion-hover)' : 'var(--bg-subtle)',
                    borderRadius: '8px',
                    overflowY: 'auto',
                    minHeight: laneMode ? '96px' : '200px',
                    maxHeight: laneMode ? '58vh' : undefined,
                    transition: 'background-color 0.2s ease'
                }}
            >
                {children}
            </div>
        </div>
    );
};

export default KanbanColumnV2;
