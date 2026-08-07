import React, { useEffect, useMemo, useState } from 'react';
import { Form } from 'react-bootstrap';
import { Goal } from '../../types';
import { getGoalDisplayPath, getLeafGoalOptions } from '../../utils/goalHierarchy';

interface GoalSearchSelectProps {
  /** Unique per mounted instance — two datalists sharing an id collide in the DOM. */
  id: string;
  goals: Goal[];
  value: string | null;
  onChange: (goalId: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Type-to-search goal picker, replacing the plain <select> that listed every goal.
 * Matches the text+datalist pattern already used by AddStoryModal and EditTaskModal:
 * free text while typing, resolved to a real goal id on blur, cleared if it matches
 * nothing so a half-typed title can never be mistaken for a selection.
 */
const GoalSearchSelect: React.FC<GoalSearchSelectProps> = ({
  id, goals, value, onChange, placeholder = 'Search goals by title...', disabled,
}) => {
  const leafGoalOptions = useMemo(() => getLeafGoalOptions(goals), [goals]);
  const [input, setInput] = useState('');

  // Keep the box in step when the parent resets or preselects the goal.
  useEffect(() => {
    if (!value) { setInput(''); return; }
    const match = goals.find((g) => g.id === value);
    setInput(match ? getGoalDisplayPath(match.id, goals) : '');
  }, [value, goals]);

  const resolve = () => {
    const val = input.trim();
    if (!val) { onChange(null); return; }
    const match = leafGoalOptions.find((g) => {
      const displayPath = getGoalDisplayPath(g.id, goals);
      return displayPath === val || g.id === val || g.title === val;
    });
    setInput(match ? getGoalDisplayPath(match.id, goals) : val);
    onChange(match ? match.id : null);
  };

  const unresolved = input.trim().length > 0 && !value;

  return (
    <>
      <Form.Control
        list={id}
        value={input}
        disabled={disabled}
        onChange={(e) => setInput(e.target.value)}
        onBlur={resolve}
        placeholder={placeholder}
      />
      <datalist id={id}>
        {leafGoalOptions.map((g) => (
          <option key={g.id} value={getGoalDisplayPath(g.id, goals)} />
        ))}
      </datalist>
      {unresolved && (
        <Form.Text className="text-warning">
          No goal matches that text — pick one from the list or clear the box.
        </Form.Text>
      )}
    </>
  );
};

export default GoalSearchSelect;
