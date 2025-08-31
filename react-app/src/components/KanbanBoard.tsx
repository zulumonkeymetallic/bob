import React from 'react';
import { useDroppableCollection, useDraggableItem, useDropIndicator } from "@react-aria/dnd";
import { useListState } from "@react-stately/list";
import { useListBox, useOption } from "@react-aria/listbox";
import { useDroppableCollectionState } from "@react-stately/dnd";
import { DraggableItemProps, DroppableCollectionOptions } from '@react-aria/dnd';
import { AriaListBoxOptions } from '@react-aria/listbox';
import { Node } from '@react-types/shared';
import type { DroppableCollectionState } from '@react-stately/dnd';


function KanbanCard({ item, onSelect }: { item: Node<object>, onSelect?: (id: string) => void }) {
  let ref = React.useRef(null);
  let { optionProps } = useOption({ key: item.key }, {} as any, ref);
  let { dragProps } = useDraggableItem({ key: item.key } as DraggableItemProps, {} as any);
  
  const handleClick = () => {
    if (onSelect) {
      onSelect(item.key.toString());
    }
  };

  return (
    <li 
      {...optionProps} 
      {...dragProps} 
      ref={ref} 
      className="bg-white rounded p-2 mb-2 shadow-sm cursor-pointer" 
      onClick={handleClick}
    >
      {item.rendered}
    </li>
  );
}

function KanbanColumn({ column, onDrop, onSelect }) {
  let state = useListState({ items: column.stories });
  let ref = React.useRef(null);
  let { listBoxProps } = useListBox({ "aria-label": column.name } as AriaListBoxOptions<any>, state, ref);
  const droppableCollection = useDroppableCollection({
      onDrop: async (e) => {
          const keys = [];
          for (const item of e.items) {
              if (item.kind === 'text') {
                  const key = await item.getText('text/plain');
                  keys.push(key);
              }
          }
          onDrop(column.id, keys);
      }
  } as any, {} as any, ref);

  const dropIndicatorRef = React.useRef(null);
  const { dropIndicatorProps } = useDropIndicator({
    target: { type: 'item', key: column.id, dropPosition: 'on' }
  }, state as unknown as DroppableCollectionState, dropIndicatorRef);

  return (
    <div className="bg-gray-100 rounded p-2 w-64">
      <h3 className="font-semibold mb-2">{column.name}</h3>
      <ul {...listBoxProps} ref={ref}>
        {[...state.collection].map(item => (
          <KanbanCard key={item.key} item={item} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  );
}

export default function KanbanBoard({ columns, onDrop, onStorySelect }) {
  return (
    <div className="flex gap-4">
      {columns.map(col => <KanbanColumn key={col.id} column={col} onDrop={onDrop} onSelect={onStorySelect} />)}
    </div>
  );
}
export {};
