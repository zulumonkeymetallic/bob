import React, { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { usePersona } from '../contexts/PersonaContext';
import { CalendarBlock } from '../types';

interface CalendarBlockManagerProps {
  className?: string;
}

export const CalendarBlockManager: React.FC<CalendarBlockManagerProps> = ({ className = '' }) => {
  const { currentPersona } = usePersona();
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingBlock, setEditingBlock] = useState<CalendarBlock | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    start: '',
    end: '',
    theme: 'Health' as CalendarBlock['theme'],
    category: 'Wellbeing' as CalendarBlock['category'],
    flexibility: 'soft' as CalendarBlock['flexibility'],
    description: ''
  });

  useEffect(() => {
    const q = query(
      collection(db, 'calendar_blocks'),
      where('persona', '==', currentPersona),
      where('status', '!=', 'superseded'),
      orderBy('start', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const blocksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as CalendarBlock[];
      setBlocks(blocksData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentPersona]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const blockData: Partial<CalendarBlock> = {
        persona: currentPersona,
        theme: formData.theme,
        category: formData.category,
        start: new Date(formData.start).getTime(),
        end: new Date(formData.end).getTime(),
        flexibility: formData.flexibility,
        status: 'proposed',
        createdBy: 'user',
        rationale: formData.description || 'Manually created block',
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      if (editingBlock) {
        await updateDoc(doc(db, 'calendar_blocks', editingBlock.id), {
          ...blockData,
          updatedAt: Date.now()
        });
        setEditingBlock(null);
      } else {
        await addDoc(collection(db, 'calendar_blocks'), blockData);
      }

      // Reset form
      setFormData({
        title: '',
        start: '',
        end: '',
        theme: 'Health',
        category: 'Wellbeing',
        flexibility: 'soft',
        description: ''
      });
      setShowAddForm(false);
    } catch (error) {
      console.error('Error saving calendar block:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (block: CalendarBlock) => {
    setEditingBlock(block);
    setFormData({
      title: block.category,
      start: new Date(block.start).toISOString().slice(0, 16),
      end: new Date(block.end).toISOString().slice(0, 16),
      theme: block.theme,
      category: block.category,
      flexibility: block.flexibility,
      description: block.rationale || ''
    });
    setShowAddForm(true);
  };

  const handleDelete = async (blockId: string) => {
    if (window.confirm('Are you sure you want to delete this calendar block?')) {
      try {
        await deleteDoc(doc(db, 'calendar_blocks', blockId));
      } catch (error) {
        console.error('Error deleting calendar block:', error);
      }
    }
  };

  const syncToGoogleCalendar = async (blockId: string) => {
    // This will call the enhanced Cloud Function to create/update Google Calendar event
    try {
      const response = await fetch('/api/syncCalendarBlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockId, action: 'create' })
      });
      
      if (response.ok) {
        alert('Successfully synced to Google Calendar!');
      } else {
        alert('Failed to sync to Google Calendar');
      }
    } catch (error) {
      console.error('Error syncing to Google Calendar:', error);
      alert('Failed to sync to Google Calendar');
    }
  };

  const formatDateTime = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getThemeColor = (theme: string) => {
    const colors = {
      Health: 'bg-green-100 text-green-800',
      Growth: 'bg-blue-100 text-blue-800',
      Wealth: 'bg-yellow-100 text-yellow-800',
      Tribe: 'bg-purple-100 text-purple-800',
      Home: 'bg-orange-100 text-orange-800'
    };
    return colors[theme as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  if (loading) {
    return (
      <div className={`${className} p-4`}>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${className} p-4`}>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">
          Calendar Blocks ({currentPersona})
        </h2>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
        >
          {showAddForm ? 'Cancel' : '+ Add Block'}
        </button>
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <div className="bg-white p-6 rounded-lg border border-gray-200 mb-6">
          <h3 className="text-lg font-semibold mb-4">
            {editingBlock ? 'Edit Calendar Block' : 'Add New Calendar Block'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Time
                </label>
                <input
                  type="datetime-local"
                  value={formData.start}
                  onChange={(e) => setFormData({ ...formData, start: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Time
                </label>
                <input
                  type="datetime-local"
                  value={formData.end}
                  onChange={(e) => setFormData({ ...formData, end: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Theme
                </label>
                <select
                  value={formData.theme}
                  onChange={(e) => setFormData({ ...formData, theme: e.target.value as CalendarBlock['theme'] })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Health">Health</option>
                  <option value="Growth">Growth</option>
                  <option value="Wealth">Wealth</option>
                  <option value="Tribe">Tribe</option>
                  <option value="Home">Home</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value as CalendarBlock['category'] })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Tribe">Tribe</option>
                  <option value="Chores">Chores</option>
                  <option value="Gaming">Gaming</option>
                  <option value="Fitness">Fitness</option>
                  <option value="Wellbeing">Wellbeing</option>
                  <option value="Sauna">Sauna</option>
                  <option value="Sleep">Sleep</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Flexibility
                </label>
                <select
                  value={formData.flexibility}
                  onChange={(e) => setFormData({ ...formData, flexibility: e.target.value as CalendarBlock['flexibility'] })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="soft">Soft (Moveable)</option>
                  <option value="hard">Hard (Fixed)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description/Rationale
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Why is this time block important?"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {loading ? 'Saving...' : editingBlock ? 'Update Block' : 'Add Block'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setEditingBlock(null);
                  setFormData({
                    title: '',
                    start: '',
                    end: '',
                    theme: 'Health',
                    category: 'Wellbeing',
                    flexibility: 'soft',
                    description: ''
                  });
                }}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Calendar Blocks List */}
      <div className="space-y-3">
        {blocks.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg">No calendar blocks found</p>
            <p className="text-sm">Add your first block to get started with time management</p>
          </div>
        ) : (
          blocks.map((block) => (
            <div key={block.id} className="bg-white p-4 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getThemeColor(block.theme)}`}>
                      {block.theme}
                    </span>
                    <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
                      {block.category}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      block.flexibility === 'hard' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                    }`}>
                      {block.flexibility}
                    </span>
                    {block.status === 'applied' && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                        In Calendar
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600 mb-1">
                    {formatDateTime(new Date(block.start))} → {formatDateTime(new Date(block.end))}
                  </div>
                  {block.rationale && (
                    <p className="text-sm text-gray-700">{block.rationale}</p>
                  )}
                </div>
                <div className="flex gap-2 ml-4">
                  {block.status !== 'applied' && (
                    <button
                      onClick={() => syncToGoogleCalendar(block.id)}
                      className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 transition-colors"
                    >
                      Sync to Calendar
                    </button>
                  )}
                  <button
                    onClick={() => handleEdit(block)}
                    className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(block.id)}
                    className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CalendarBlockManager;
