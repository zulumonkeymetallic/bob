import React, { useMemo, useState } from 'react';
import { Badge, Button, Form, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { Calendar, CreditCard, DollarSign, Layers, Save, ShoppingBag, Tag, X, Pencil, Trash2, RefreshCw, AlertCircle } from 'lucide-react';

interface Transaction {
    id?: string;
    transactionId?: string;
    description: string;
    merchantName?: string | null;
    amount: number;
    createdISO: string | null;
    userCategoryType?: string | null;
    userCategoryLabel?: string | null;
    aiBucket?: string | null;
    aiCategoryKey?: string | null;
    aiCategoryLabel?: string | null;
    defaultCategoryType?: string | null;
    defaultCategoryLabel?: string | null;
    potName?: string | null;
    aiAnomalyFlag?: boolean;
    isSubscription?: boolean;
}

interface TransactionTableProps {
    transactions: Transaction[];
    compact?: boolean; // Hide more columns for smaller spaces
    onSave?: (txId: string, category: string, label: string) => void;
    onDelete?: (txId: string) => void; // Delete transaction action
    showActions?: boolean; // Show save/edit/delete actions
    showSubscription?: boolean; // Show subscription column
    maxHeight?: string; // Max height for scrolling
    filterUncategorised?: boolean; // Show filter for uncategorised toggle
}

const getBucketInfo = (tx: Transaction) => {
    const bucket = (tx.userCategoryType || tx.aiBucket || tx.defaultCategoryType || '').toLowerCase();
    const label = bucket.includes('mandatory') || bucket === 'debt_repayment' ? 'Mandatory' :
                 bucket === 'discretionary' || bucket === 'optional' ? 'Discretionary' :
                 bucket.includes('saving') || bucket === 'investment' ? 'Savings' :
                 bucket === 'net_salary' || bucket === 'irregular_income' || bucket === 'income' ? 'Income' :
                 bucket === 'bank_transfer' ? 'Transfer' :
                 bucket === 'unknown' ? 'Unknown' : 'Other';
    const variant = label === 'Mandatory' ? 'danger' :
                   label === 'Discretionary' ? 'warning' :
                   label === 'Savings' ? 'info' :
                   label === 'Income' ? 'success' :
                   label === 'Transfer' ? 'secondary' :
                   'light';
    return { label, variant };
};

const getCategoryLabel = (tx: Transaction) => {
    return tx.userCategoryLabel || tx.aiCategoryLabel || tx.defaultCategoryLabel || 'Uncategorised';
};

const TransactionTable: React.FC<TransactionTableProps> = ({
    transactions,
    compact = false,
    onSave,
    onDelete,
    showActions = false,
    showSubscription = true,
    maxHeight = '500px',
    filterUncategorised = false,
}) => {
    const [showUncategorisedOnly, setShowUncategorisedOnly] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editCategory, setEditCategory] = useState('');
    const [editLabel, setEditLabel] = useState('');

    const filteredTxs = useMemo(() => {
        let result = transactions;
        if (showUncategorisedOnly) {
            result = result.filter(tx => {
                const cat = getCategoryLabel(tx);
                return cat === 'Uncategorised' || cat === 'Unknown';
            });
        }
        return result;
    }, [transactions, showUncategorisedOnly]);

    const handleEdit = (tx: Transaction) => {
        const txId = tx.id || tx.transactionId || '';
        setEditingId(txId);
        setEditCategory(tx.userCategoryType || tx.defaultCategoryType || 'discretionary');
        setEditLabel(tx.userCategoryLabel || tx.defaultCategoryLabel || tx.description);
    };

    const handleSave = (tx: Transaction) => {
        const txId = tx.id || tx.transactionId || '';
        if (onSave) {
            onSave(txId, editCategory, editLabel);
        }
        setEditingId(null);
    };

    const handleCancel = () => {
        setEditingId(null);
    };

    return (
        <div>
            {filterUncategorised && (
                <div className="d-flex align-items-center gap-2 mb-3">
                    <Form.Check
                        type="checkbox"
                        id="filter-uncategorised"
                        label="Show uncategorised only"
                        checked={showUncategorisedOnly}
                        onChange={(e) => setShowUncategorisedOnly(e.target.checked)}
                    />
                    <Badge bg="secondary">{filteredTxs.length} transactions</Badge>
                </div>
            )}

            <div style={{ maxHeight, overflowY: 'auto', overflowX: 'auto' }}>
                <table className="table table-sm table-hover align-middle">
                    <thead className="sticky-top bg-white" style={{ top: 0, zIndex: 10 }}>
                        <tr>
                            <th style={{ width: compact ? '15%' : '12%' }}>
                                <OverlayTrigger overlay={<Tooltip>Transaction Date</Tooltip>}>
                                    <span><Calendar size={14} className="me-1" />Date</span>
                                </OverlayTrigger>
                            </th>
                            {!compact && (
                                <th style={{ width: '18%' }}>
                                    <OverlayTrigger overlay={<Tooltip>Merchant Name</Tooltip>}>
                                        <span><ShoppingBag size={14} className="me-1" />Merchant</span>
                                    </OverlayTrigger>
                                </th>
                            )}
                            <th style={{ width: compact ? '25%' : '15%' }}>
                                <OverlayTrigger overlay={<Tooltip>Transaction Description</Tooltip>}>
                                    <span><CreditCard size={14} className="me-1" />Description</span>
                                </OverlayTrigger>
                            </th>
                            <th style={{ width: '12%' }} className="text-end">
                                <OverlayTrigger overlay={<Tooltip>Transaction Amount</Tooltip>}>
                                    <span><DollarSign size={14} className="me-1" />Amount</span>
                                </OverlayTrigger>
                            </th>
                            {!compact && (
                                <th style={{ width: '10%' }}>
                                    <OverlayTrigger overlay={<Tooltip>Spending Bucket</Tooltip>}>
                                        <span><Layers size={14} className="me-1" />Bucket</span>
                                    </OverlayTrigger>
                                </th>
                            )}
                            <th style={{ width: compact ? '18%' : '15%' }}>
                                <OverlayTrigger overlay={<Tooltip>Spending Category</Tooltip>}>
                                    <span><Tag size={14} className="me-1" />Category</span>
                                </OverlayTrigger>
                            </th>
                            {!compact && (
                                <th style={{ width: '12%' }}>
                                    <OverlayTrigger overlay={<Tooltip>Monzo Pot</Tooltip>}>
                                        <span>Pot</span>
                                    </OverlayTrigger>
                                </th>
                            )}
                            {showSubscription && !compact && (
                                <th style={{ width: '8%' }} className="text-center">
                                    <OverlayTrigger overlay={<Tooltip>Recurring Subscription</Tooltip>}>
                                        <span><RefreshCw size={14} className="me-1" />Sub</span>
                                    </OverlayTrigger>
                                </th>
                            )}
                            {showActions && (
                                <th style={{ width: compact ? '15%' : '10%' }} className="text-center">Actions</th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredTxs.length === 0 && (
                            <tr>
                                <td colSpan={compact ? 5 : (showSubscription ? 9 : 8)} className="text-center text-muted py-4">
                                    {showUncategorisedOnly ? 'No uncategorised transactions' : 'No transactions'}
                                </td>
                            </tr>
                        )}
                        {filteredTxs.slice(0, 200).map((tx) => {
                            const txId = tx.id || tx.transactionId || Math.random().toString();
                            const isEditing = editingId === txId;
                            const bucket = getBucketInfo(tx);
                            const category = getCategoryLabel(tx);
                            const date = tx.createdISO ? new Date(tx.createdISO) : null;
                            const dateStr = date ? date.toLocaleDateString('en-GB', {
                                day: 'numeric',
                                month: 'short',
                                year: compact ? undefined : 'numeric'
                            }) : '—';
                            const amount = tx.amount || 0;
                            const isNegative = amount < 0;

                            return (
                                <tr key={txId} style={{ opacity: tx.aiAnomalyFlag ? 0.9 : 1 }}>
                                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>{dateStr}</td>
                                    {!compact && (
                                        <td style={{ fontSize: '0.85rem' }}>
                                            <div className="text-truncate" style={{ maxWidth: '150px' }}>
                                                {tx.merchantName || '—'}
                                            </div>
                                        </td>
                                    )}
                                    <td style={{ fontSize: '0.85rem' }}>
                                        <div className="text-truncate" style={{ maxWidth: compact ? '200px' : '150px' }}>
                                            {tx.description}
                                        </div>
                                    </td>
                                    <td className="text-end" style={{
                                        fontWeight: 600,
                                        fontSize: '0.9rem',
                                        color: isNegative ? '#dc3545' : '#28a745'
                                    }}>
                                        {isNegative ? '-' : '+'}£{Math.abs(amount / 100).toFixed(2)}
                                    </td>
                                    {!compact && (
                                        <td>
                                            <Badge
                                                bg={bucket.variant}
                                                className="text-uppercase"
                                                style={{ fontSize: '0.65rem' }}
                                            >
                                                {bucket.label}
                                            </Badge>
                                        </td>
                                    )}
                                    <td>
                                        {isEditing ? (
                                            <Form.Select
                                                size="sm"
                                                value={editCategory}
                                                onChange={(e) => setEditCategory(e.target.value)}
                                                style={{ fontSize: '0.75rem' }}
                                            >
                                                <option value="mandatory">Mandatory</option>
                                                <option value="discretionary">Discretionary</option>
                                                <option value="savings">Savings</option>
                                                <option value="income">Income</option>
                                            </Form.Select>
                                        ) : (
                                            <small className="text-muted">{category}</small>
                                        )}
                                    </td>
                                    {!compact && (
                                        <td>
                                            <small className="text-muted">{tx.potName || '—'}</small>
                                        </td>
                                    )}
                                    {showSubscription && !compact && (
                                        <td className="text-center">
                                            {tx.isSubscription ? (
                                                <OverlayTrigger overlay={<Tooltip>Recurring subscription</Tooltip>}>
                                                    <Badge bg="info" style={{ fontSize: '0.65rem' }}>
                                                        <RefreshCw size={10} />
                                                    </Badge>
                                                </OverlayTrigger>
                                            ) : (
                                                <span className="text-muted">—</span>
                                            )}
                                        </td>
                                    )}
                                    {showActions && (
                                        <td>
                                            {isEditing ? (
                                                <div className="d-flex gap-1 justify-content-center">
                                                    <OverlayTrigger overlay={<Tooltip>Save changes</Tooltip>}>
                                                        <Button
                                                            size="sm"
                                                            variant="outline-success"
                                                            onClick={() => handleSave(tx)}
                                                            style={{ padding: '2px 6px' }}
                                                        >
                                                            <Save size={14} />
                                                        </Button>
                                                    </OverlayTrigger>
                                                    <OverlayTrigger overlay={<Tooltip>Cancel</Tooltip>}>
                                                        <Button
                                                            size="sm"
                                                            variant="outline-secondary"
                                                            onClick={handleCancel}
                                                            style={{ padding: '2px 6px' }}
                                                        >
                                                            <X size={14} />
                                                        </Button>
                                                    </OverlayTrigger>
                                                </div>
                                            ) : (
                                                <div className="d-flex gap-1 justify-content-center">
                                                    <OverlayTrigger overlay={<Tooltip>Edit category</Tooltip>}>
                                                        <button
                                                            onClick={() => handleEdit(tx)}
                                                            style={{
                                                                padding: 4,
                                                                borderRadius: 4,
                                                                border: 'none',
                                                                background: 'transparent',
                                                                cursor: 'pointer',
                                                                color: '#0d6efd'
                                                            }}
                                                        >
                                                            <Pencil size={14} />
                                                        </button>
                                                    </OverlayTrigger>
                                                    {onDelete && tx.aiAnomalyFlag && (
                                                        <OverlayTrigger overlay={<Tooltip>Delete anomalous transaction</Tooltip>}>
                                                            <button
                                                                onClick={() => onDelete(txId)}
                                                                style={{
                                                                    padding: 4,
                                                                    borderRadius: 4,
                                                                    border: 'none',
                                                                    background: 'transparent',
                                                                    cursor: 'pointer',
                                                                    color: '#dc3545'
                                                                }}
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </OverlayTrigger>
                                                    )}
                                                    {tx.aiAnomalyFlag && (
                                                        <OverlayTrigger overlay={<Tooltip>Flagged as anomaly</Tooltip>}>
                                                            <span style={{ color: '#ffc107' }}>
                                                                <AlertCircle size={14} />
                                                            </span>
                                                        </OverlayTrigger>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {filteredTxs.length > 200 && (
                    <div className="text-center text-muted py-2">
                        <small>Showing first 200 of {filteredTxs.length} transactions</small>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TransactionTable;
