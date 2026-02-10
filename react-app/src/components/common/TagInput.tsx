import React, { useState, KeyboardEvent } from 'react';
import { Badge } from 'react-bootstrap';
import { X } from 'lucide-react';

interface TagInputProps {
    value: string[];
    onChange: (tags: string[]) => void;
    placeholder?: string;
    suggestions?: string[];
    formatTag?: (tag: string) => string;
}

const TagInput: React.FC<TagInputProps> = ({ value = [], onChange, placeholder = "Add tag...", suggestions = [], formatTag }) => {
    const [input, setInput] = useState('');

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag();
        } else if (e.key === 'Backspace' && !input && value.length > 0) {
            removeTag(value.length - 1);
        }
    };

    const addTag = () => {
        const trimmed = input.trim().replace(/^#/, ''); // Remove leading # if user types it
        if (trimmed && !value.includes(trimmed)) {
            onChange([...value, trimmed]);
            setInput('');
        }
    };

    const removeTag = (index: number) => {
        onChange(value.filter((_, i) => i !== index));
    };

    return (
        <div className="form-control d-flex flex-wrap gap-2 align-items-center" style={{ minHeight: '38px', padding: '4px 8px' }}>
            {value.map((tag, index) => {
                const formatted = formatTag ? formatTag(tag) : tag;
                const display = formatted && String(formatted).trim().length > 0 ? formatted : tag;
                const title = display !== tag ? `#${tag}` : undefined;
                return (
                    <Badge
                        key={index}
                        bg="secondary"
                        title={title}
                        className="d-flex align-items-center gap-1"
                        style={{ fontSize: '12px', fontWeight: 500 }}
                    >
                        #{display}
                        <X size={12} style={{ cursor: 'pointer' }} onClick={() => removeTag(index)} />
                    </Badge>
                );
            })}
            <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={addTag}
                placeholder={value.length === 0 ? placeholder : ""}
                style={{ border: 'none', outline: 'none', flex: 1, minWidth: '60px', background: 'transparent', fontSize: '14px' }}
                list="tag-suggestions"
            />
            {suggestions.length > 0 && (
                <datalist id="tag-suggestions">
                    {suggestions.map(s => <option key={s} value={s} />)}
                </datalist>
            )}
        </div>
    );
};

export default TagInput;
