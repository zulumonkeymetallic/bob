import React, { useState, useEffect } from 'react';
import { DragDropContext, DropResult } from 'react-beautiful-dnd';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import Column from './Column';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Task, Column as ColumnType } from '../types';

const KanbanBoard = () => {
  const [tasks, setTasks] = useState<{ [key: string]: Task }>({});
  const [columns, setColumns] = useState<{ [key: string]: ColumnType }>({});
  const [columnOrder, setColumnOrder] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) {
        const statuses = ['backlog', 'doing', 'done'];
        const q = query(collection(db, 'tasks'), where('ownerUid', '==', user.uid));

        const unsubscribeSnapshot = onSnapshot(q, snapshot => {
          const newTasks: { [key: string]: Task } = {};
          snapshot.forEach(doc => {
            newTasks[doc.id] = { id: doc.id, ...doc.data() } as Task;
          });
          setTasks(newTasks);

          const newColumns: { [key: string]: ColumnType } = {};
          statuses.forEach(status => {
            newColumns[status] = {
              id: status,
              title: status.charAt(0).toUpperCase() + status.slice(1),
              taskIds: Object.values(newTasks)
                .filter(task => task.status === status)
                .map(task => task.id),
            };
          });

          setColumns(newColumns);
          setColumnOrder(statuses);
        });

        return () => unsubscribeSnapshot();
      } else {
        setTasks({});
        setColumns({});
        setColumnOrder([]);
      }
    });

    return () => unsubscribe();
  }, []);

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) {
      return;
    }

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    const start = columns[source.droppableId];
    const end = columns[destination.droppableId];

    if (start === end) {
      const newTaskIds = Array.from(start.taskIds);
      newTaskIds.splice(source.index, 1);
      newTaskIds.splice(destination.index, 0, draggableId);

      const newColumn = {
        ...start,
        taskIds: newTaskIds,
      };

      const newColumns = {
        ...columns,
        [newColumn.id]: newColumn,
      };
      setColumns(newColumns);

    } else {
      const startTaskIds = Array.from(start.taskIds);
      startTaskIds.splice(source.index, 1);
      const newStart = {
        ...start,
        taskIds: startTaskIds,
      };

      const endTaskIds = Array.from(end.taskIds);
      endTaskIds.splice(destination.index, 0, draggableId);
      const newEnd = {
        ...end,
        taskIds: endTaskIds,
      };

      const newColumns = {
        ...columns,
        [newStart.id]: newStart,
        [newEnd.id]: newEnd,
      };

      setColumns(newColumns);

      const taskRef = doc(db, 'tasks', draggableId);
      updateDoc(taskRef, { status: destination.droppableId });
    }
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="container-fluid">
        <div className="row">
          {columnOrder.map(columnId => {
            const column = columns[columnId];
            const columnTasks = column.taskIds.map(taskId => tasks[taskId]);

            return <Column key={column.id} column={column} tasks={columnTasks} />;
          })}
        </div>
      </div>
    </DragDropContext>
  );
};

export default KanbanBoard;