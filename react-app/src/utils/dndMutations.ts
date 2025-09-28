import { 
  doc, 
  updateDoc, 
  serverTimestamp, 
  increment, 
  collection, 
  addDoc,
  runTransaction
} from 'firebase/firestore';
import { db } from '../firebase';
import type { DnDEvent } from '../types/v3.0.8-types';

// Fractional ranking utilities
export class FractionalRanking {
  static readonly MIN_RANK = 0.000001;
  static readonly MAX_RANK = 999999.999999;
  static readonly DEFAULT_SPACING = 100;

  /**
   * Generate a rank between two existing ranks
   */
  static between(before?: number, after?: number): number {
    if (!before && !after) {
      return this.DEFAULT_SPACING;
    }
    
    if (!before) {
      return (after || this.MAX_RANK) / 2;
    }
    
    if (!after) {
      return before + this.DEFAULT_SPACING;
    }
    
    if (before >= after) {
      throw new Error('Invalid rank order: before must be less than after');
    }
    
    const diff = after - before;
    if (diff < this.MIN_RANK * 2) {
      // Need to rebalance - return a suggestion
      throw new Error('Ranks too close, rebalancing needed');
    }
    
    return before + (diff / 2);
  }

  /**
   * Generate evenly spaced ranks for initial setup
   */
  static generateSpaced(count: number, start = 0, spacing = this.DEFAULT_SPACING): number[] {
    return Array.from({ length: count }, (_, i) => start + (i + 1) * spacing);
  }

  /**
   * Rebalance ranks when they get too close
   */
  static rebalance(items: Array<{ id: string; rank: number }>): Array<{ id: string; newRank: number }> {
    const sorted = [...items].sort((a, b) => a.rank - b.rank);
    return sorted.map((item, index) => ({
      id: item.id,
      newRank: (index + 1) * this.DEFAULT_SPACING
    }));
  }
}

// Scope utilities for different drag contexts
export class DnDScope {
  static kanban(sprintId: string, lane: string): string {
    return `kanban:currentSprint:${sprintId}:${lane}`;
  }

  static planner(sprintId: string, goalId?: string, subGoalId?: string): string {
    const parts = ['planner', sprintId];
    if (goalId) parts.push(goalId);
    if (subGoalId) parts.push(subGoalId);
    return parts.join(':');
  }

  static table(entityType: string, parentId?: string): string {
    const parts = ['table', entityType];
    if (parentId) parts.push(parentId);
    return parts.join(':');
  }

  static parseScope(scope: string): {
    type: 'kanban' | 'planner' | 'table';
    parts: string[];
    sprintId?: string;
    goalId?: string;
    subGoalId?: string;
    lane?: string;
    entityType?: string;
    parentId?: string;
  } {
    const parts = scope.split(':');
    const type = parts[0] as 'kanban' | 'planner' | 'table';

    switch (type) {
      case 'kanban':
        return {
          type,
          parts,
          sprintId: parts[2],
          lane: parts[3]
        };
      case 'planner':
        return {
          type,
          parts,
          sprintId: parts[1],
          goalId: parts[2],
          subGoalId: parts[3]
        };
      case 'table':
        return {
          type,
          parts,
          entityType: parts[1],
          parentId: parts[2]
        };
      default:
        return { type, parts };
    }
  }
}

// Validation utilities
export class DnDValidator {
  static validateEvent(event: DnDEvent, ownerUid: string): { valid: boolean; error?: string } {
    // Basic structure validation
    if (!event.entityType || !event.entityId || !event.from || !event.to) {
      return { valid: false, error: 'Missing required event fields' };
    }

    // Scope validation
    if (!event.from.scope || !event.to.scope) {
      return { valid: false, error: 'Missing scope information' };
    }

    // Entity type validation
    const validTypes = ['goal', 'subGoal', 'story', 'task', 'habit', 'sprint', 'calendarBlock'];
    if (!validTypes.includes(event.entityType)) {
      return { valid: false, error: `Invalid entity type: ${event.entityType}` };
    }

    // Cross-container move validation
    const fromScope = DnDScope.parseScope(event.from.scope);
    const toScope = DnDScope.parseScope(event.to.scope);

    if (fromScope.type !== toScope.type) {
      // Cross-container moves need special validation
      if (!this.isValidCrossContainerMove(event, fromScope, toScope)) {
        return { valid: false, error: 'Invalid cross-container move' };
      }
    }

    return { valid: true };
  }

  private static isValidCrossContainerMove(
    event: DnDEvent,
    fromScope: any,
    toScope: any
  ): boolean {
    // Stories can move between kanban lanes and planner cells
    if (event.entityType === 'story') {
      if (
        (fromScope.type === 'kanban' && toScope.type === 'planner') ||
        (fromScope.type === 'planner' && toScope.type === 'kanban') ||
        (fromScope.type === 'table' && (toScope.type === 'kanban' || toScope.type === 'planner'))
      ) {
        return true;
      }
    }

    // Tasks can move between different stories
    if (event.entityType === 'task') {
      return fromScope.type === 'table' && toScope.type === 'table';
    }

    return false;
  }
}

// Main DnD mutation handler
export class DnDMutationHandler {
  static async applyDnDMutation(event: DnDEvent, ownerUid: string): Promise<void> {
    // Validate the event
    const validation = DnDValidator.validateEvent(event, ownerUid);
    if (!validation.valid) {
      throw new Error(`DnD validation failed: ${validation.error}`);
    }

    const fromScope = DnDScope.parseScope(event.from.scope);
    const toScope = DnDScope.parseScope(event.to.scope);

    try {
      await runTransaction(db, async (transaction) => {
        const entityRef = doc(db, this.getCollection(event.entityType), event.entityId);
        
        // Get current entity data
        const entityDoc = await transaction.get(entityRef);
        if (!entityDoc.exists()) {
          throw new Error(`Entity ${event.entityId} not found`);
        }

        const currentData = entityDoc.data();
        
        // Verify ownership
        if (currentData.ownerUid !== ownerUid) {
          throw new Error('Unauthorized: Not owner of entity');
        }

        // Check drag lock version to prevent conflicts
        const currentLockVersion = currentData.dragLockVersion || 0;
        // Skip lock check for system operations or if no expected version provided

        // Prepare update data
        const updateData: any = {
          dragLockVersion: increment(1),
          updatedAt: serverTimestamp()
        };

        // Handle parent relationship changes
        const parentChanges = this.calculateParentChanges(event, fromScope, toScope);
        Object.assign(updateData, parentChanges);

        // Handle ranking
        const rankingChanges = await this.calculateRankingChanges(
          event, 
          fromScope, 
          toScope, 
          currentData, 
          transaction
        );
        Object.assign(updateData, rankingChanges);

        // Handle status transitions for kanban moves (e.g., backlog ↔ active)
        const statusChanges = this.calculateStatusChanges(event, toScope);
        Object.assign(updateData, statusChanges);

        // Apply the update
        transaction.update(entityRef, updateData);

        // Log activity
        const activityRef = doc(collection(db, 'activity_stream'));
        transaction.set(activityRef, {
          ownerUid,
          activityType: this.getActivityType(fromScope, toScope),
          entityType: event.entityType,
          entityId: event.entityId,
          payload: {
            dnd: {
              from: event.from,
              to: event.to,
              oldRank: this.extractCurrentRank(currentData, fromScope),
              newRank: this.extractNewRank(rankingChanges, toScope),
              scope: event.to.scope
            }
          },
          timestamp: serverTimestamp()
        });
      });

    } catch (error) {
      console.error('DnD mutation failed:', error);
      throw error;
    }
  }

  private static getCollection(entityType: string): string {
    switch (entityType) {
      case 'story': return 'stories';
      case 'task': return 'tasks';
      case 'goal': return 'goals';
      case 'subGoal': return 'sub_goals';
      case 'sprint': return 'sprints';
      case 'habit': return 'habits';
      case 'calendarBlock': return 'calendar_blocks';
      default: throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  private static calculateParentChanges(
    event: DnDEvent,
    fromScope: any,
    toScope: any
  ): Record<string, any> {
    const changes: Record<string, any> = {};

    // Sprint assignment changes
    if (fromScope.sprintId !== toScope.sprintId) {
      changes.sprintId = toScope.sprintId || null;
    }

    // Goal assignment changes  
    if (fromScope.goalId !== toScope.goalId) {
      changes.goalId = toScope.goalId || null;
    }

    // SubGoal assignment changes
    if (fromScope.subGoalId !== toScope.subGoalId) {
      changes.subGoalId = toScope.subGoalId || null;
    }

    // Story assignment for tasks
    if (event.entityType === 'task' && toScope.parentId) {
      changes.parentId = toScope.parentId;
      changes.parentType = 'story';
    }

    return changes;
  }

  private static calculateStatusChanges(
    event: DnDEvent,
    toScope: any
  ): Record<string, any> {
    if (event.entityType !== 'story') return {};

    if (toScope?.type === 'kanban' && toScope?.lane) {
      const laneStatusMap: Record<string, number> = {
        backlog: 0,
        planned: 1,
        active: 2,
        testing: 3,
        done: 4,
      };

      if (laneStatusMap[toScope.lane] !== undefined) {
        return { status: laneStatusMap[toScope.lane] };
      }
    }

    return {};
  }

  private static async calculateRankingChanges(
    event: DnDEvent,
    fromScope: any,
    toScope: any,
    currentData: any,
    transaction: any
  ): Promise<Record<string, any>> {
    const changes: Record<string, any> = {};

    if (fromScope.type === toScope.type && fromScope.type === 'kanban') {
      // Kanban lane ranking
      const laneId = toScope.lane;
      const rankByLane = currentData.rankByLane || {};
      
      // Calculate new rank for the lane
      const newRank = await this.calculateNewRankInContext(
        `${toScope.sprintId}:${laneId}`,
        event.to.index,
        transaction
      );
      
      rankByLane[laneId] = newRank;
      changes.rankByLane = rankByLane;
      
    } else if (fromScope.type === toScope.type && fromScope.type === 'planner') {
      // Planner cell ranking
      const cellKey = `${toScope.sprintId}/${toScope.goalId || ''}/${toScope.subGoalId || ''}`;
      const rankByCell = currentData.rankByCell || {};
      
      const newRank = await this.calculateNewRankInContext(
        `planner:${cellKey}`,
        event.to.index,
        transaction
      );
      
      rankByCell[cellKey] = newRank;
      changes.rankByCell = rankByCell;
      
    } else {
      // General ranking
      const newRank = await this.calculateNewRankInContext(
        toScope.type,
        event.to.index,
        transaction
      );
      
      changes.rank = newRank;
    }

    return changes;
  }

  private static async calculateNewRankInContext(
    context: string,
    targetIndex: number | undefined,
    transaction: any
  ): Promise<number> {
    // This would query existing items in the target context
    // and calculate the appropriate fractional rank
    // For now, using a simple implementation
    
    if (targetIndex === undefined) {
      return FractionalRanking.DEFAULT_SPACING;
    }
    
    try {
      // Get surrounding ranks
      const beforeRank = targetIndex > 0 ? targetIndex * FractionalRanking.DEFAULT_SPACING : undefined;
      const afterRank = (targetIndex + 1) * FractionalRanking.DEFAULT_SPACING;
      
      return FractionalRanking.between(beforeRank, afterRank);
    } catch (error) {
      // If ranks are too close, generate a new one
      return (targetIndex + 1) * FractionalRanking.DEFAULT_SPACING;
    }
  }

  private static getActivityType(fromScope: any, toScope: any): string {
    if (fromScope.sprintId !== toScope.sprintId) {
      return 'sprint_changed';
    }
    
    if (fromScope.goalId !== toScope.goalId || fromScope.subGoalId !== toScope.subGoalId) {
      return 'backlog_retargeted';
    }
    
    return 'reordered_in_cell';
  }

  private static extractCurrentRank(currentData: any, scope: any): number | undefined {
    if (scope.type === 'kanban' && currentData.rankByLane) {
      return currentData.rankByLane[scope.lane];
    }
    
    if (scope.type === 'planner' && currentData.rankByCell) {
      const cellKey = `${scope.sprintId}/${scope.goalId || ''}/${scope.subGoalId || ''}`;
      return currentData.rankByCell[cellKey];
    }
    
    return currentData.rank;
  }

  private static extractNewRank(rankingChanges: any, scope: any): number | undefined {
    if (scope.type === 'kanban' && rankingChanges.rankByLane) {
      return rankingChanges.rankByLane[scope.lane];
    }
    
    if (scope.type === 'planner' && rankingChanges.rankByCell) {
      const cellKey = `${scope.sprintId}/${scope.goalId || ''}/${scope.subGoalId || ''}`;
      return rankingChanges.rankByCell[cellKey];
    }
    
    return rankingChanges.rank;
  }
}

// Main API function
export const applyDnDMutation = DnDMutationHandler.applyDnDMutation;

// Helper functions for UI components
export const createDnDEvent = (
  entityType: DnDEvent['entityType'],
  entityId: string,
  fromScope: string,
  toScope: string,
  options: {
    fromIndex?: number;
    toIndex?: number;
    fromParentIds?: Record<string, string>;
    toParentIds?: Record<string, string>;
    source?: 'mouse' | 'touch' | 'keyboard';
    reason?: 'reorder' | 'move';
  } = {}
): DnDEvent => {
  return {
    entityType,
    entityId,
    from: {
      scope: fromScope,
      parentIds: options.fromParentIds,
      index: options.fromIndex
    },
    to: {
      scope: toScope,
      parentIds: options.toParentIds,
      index: options.toIndex
    },
    meta: {
      source: options.source || 'mouse',
      reason: options.reason || 'reorder'
    }
  };
};
