import { useState, useCallback, useMemo } from 'react';

interface UseGlobalEditOptions<T> {
  items: T[];
  getItemId: (item: T) => string;
  onBulkEdit?: (selectedItems: T[], action: string) => void;
  onBulkDelete?: (selectedIds: string[]) => void;
}

export function useGlobalEdit<T>({
  items,
  getItemId,
  onBulkEdit,
  onBulkDelete
}: UseGlobalEditOptions<T>) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Toggle edit mode
  const toggleEditMode = useCallback(() => {
    setIsEditMode(prev => {
      if (prev) {
        // Exiting edit mode - clear selections
        setSelectedIds([]);
      }
      return !prev;
    });
  }, []);

  // Toggle selection for a single item
  const toggleSelection = useCallback((itemId: string) => {
    setSelectedIds(prev => 
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    );
  }, []);

  // Select all items
  const selectAll = useCallback(() => {
    setSelectedIds(items.map(getItemId));
  }, [items, getItemId]);

  // Deselect all items
  const deselectAll = useCallback(() => {
    setSelectedIds([]);
  }, []);

  // Check if an item is selected
  const isSelected = useCallback((itemId: string) => {
    return selectedIds.includes(itemId);
  }, [selectedIds]);

  // Get selected items
  const selectedItems = useMemo(() => {
    return items.filter(item => selectedIds.includes(getItemId(item)));
  }, [items, selectedIds, getItemId]);

  // Handle bulk actions
  const handleBulkAction = useCallback((action: string) => {
    const selected = items.filter(item => selectedIds.includes(getItemId(item)));
    
    switch (action) {
      case 'delete':
        if (onBulkDelete) {
          onBulkDelete(selectedIds);
        }
        break;
      default:
        if (onBulkEdit) {
          onBulkEdit(selected, action);
        }
        break;
    }
    
    // Clear selections after action
    setSelectedIds([]);
  }, [items, selectedIds, getItemId, onBulkEdit, onBulkDelete]);

  // Get checkbox props for table rows
  const getRowCheckboxProps = useCallback((itemId: string) => ({
    checked: isSelected(itemId),
    onChange: () => toggleSelection(itemId)
  }), [isSelected, toggleSelection]);

  // Get row click props for selection
  const getRowProps = useCallback((itemId: string) => ({
    onClick: isEditMode ? () => toggleSelection(itemId) : undefined,
    style: {
      cursor: isEditMode ? 'pointer' : 'default',
      backgroundColor: isSelected(itemId) ? 'rgba(var(--bs-primary-rgb), 0.08)' : undefined,
      borderColor: isSelected(itemId) ? 'rgba(var(--bs-primary-rgb), 0.2)' : undefined
    },
    className: `
      ${isSelected(itemId) ? 'table-active global-edit-selected' : ''} 
      ${isEditMode ? 'global-edit-selectable' : ''}
    `.trim()
  }), [isEditMode, isSelected, toggleSelection]);

  return {
    // State
    isEditMode,
    selectedIds,
    selectedItems,
    selectedCount: selectedIds.length,
    
    // Actions
    toggleEditMode,
    toggleSelection,
    selectAll,
    deselectAll,
    isSelected,
    handleBulkAction,
    
    // Helper props
    getRowCheckboxProps,
    getRowProps
  };
}

export default useGlobalEdit;
