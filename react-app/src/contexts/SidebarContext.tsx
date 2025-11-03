import React, { createContext, useContext, useState, ReactNode, useRef } from 'react';
import { Story, Task, Goal, Sprint } from '../types';

interface SidebarContextType {
  selectedItem: Story | Task | Goal | null;
  selectedType: 'story' | 'task' | 'goal' | null;
  isVisible: boolean;
  isCollapsed: boolean;
  showSidebar: (item: Story | Task | Goal, type: 'story' | 'task' | 'goal') => void;
  hideSidebar: () => void;
  toggleCollapse: () => void;
  updateItem: (updates: any) => Promise<void>;
  setUpdateHandler: (handler: (item: Story | Task | Goal, type: 'story' | 'task' | 'goal', updates: any) => Promise<void>) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

interface SidebarProviderProps {
  children: ReactNode;
}

export const SidebarProvider: React.FC<SidebarProviderProps> = ({ children }) => {
  const [selectedItem, setSelectedItem] = useState<Story | Task | Goal | null>(null);
  const [selectedType, setSelectedType] = useState<'story' | 'task' | 'goal' | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('globalSidebarCollapsed') === '1';
    } catch { return false; }
  });
  const [updateHandler, setUpdateHandler] = useState<((item: Story | Task | Goal, type: 'story' | 'task' | 'goal', updates: any) => Promise<void>) | null>(null);
  const updateHandlerRef = useRef<typeof updateHandler>(null);

  const showSidebar = (item: Story | Task | Goal, type: 'story' | 'task' | 'goal') => {
    setSelectedItem(item);
    setSelectedType(type);
    setIsVisible(true);
    setIsCollapsed(false);
  };

  const hideSidebar = () => {
    setIsVisible(false);
    setSelectedItem(null);
    setSelectedType(null);
  };

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem('globalSidebarCollapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  };

  const updateItem = async (updates: any) => {
    if (selectedItem && selectedType && updateHandler) {
      await updateHandler(selectedItem, selectedType, updates);
      // Update the local state with the updates
      setSelectedItem({ ...selectedItem, ...updates });
    }
  };

  const setUpdateHandlerCallback = (handler: (item: Story | Task | Goal, type: 'story' | 'task' | 'goal', updates: any) => Promise<void>) => {
    // Avoid unnecessary state updates to prevent render loops
    if (updateHandlerRef.current === handler) return;
    updateHandlerRef.current = handler;
    setUpdateHandler(() => handler);
  };

  return (
    <SidebarContext.Provider
      value={{
        selectedItem,
        selectedType,
        isVisible,
        isCollapsed,
        showSidebar,
        hideSidebar,
        toggleCollapse,
        updateItem,
        setUpdateHandler: setUpdateHandlerCallback,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
};

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};
