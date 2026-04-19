/**
 * Defensive error handling for Firestore queries
 * Provides user-friendly feedback when indexes are still building
 */

interface ToastConfig {
  title: string;
  description: string;
  variant: 'info' | 'warning' | 'error' | 'success';
}

/**
 * Generic error handler for Firestore onSnapshot operations
 * Handles the common failed-precondition error gracefully
 */
export const createFirestoreErrorHandler = (
  entityType: string,
  showToast?: (config: ToastConfig) => void
) => {
  return (error: any) => {
    console.error(`🔥 Firestore query error for ${entityType}:`, error);
    
    if (error.code === "failed-precondition") {
      const message = `Building database index for ${entityType}. Data will appear when ready.`;
      
      if (showToast) {
        showToast({
          title: "Finishing setup…",
          description: message,
          variant: "info"
        });
      }
      
      console.info(`📊 ${message}`);
      return;
    }
    
    // For other errors, log them but don't crash the UI
    if (showToast) {
      showToast({
        title: "Data Loading Issue",
        description: `Unable to load ${entityType}. Please refresh the page.`,
        variant: "warning"
      });
    }
  };
};

/**
 * Simple console-only error handler for components that don't have toast notifications
 */
export const simpleFirestoreErrorHandler = (entityType: string) => {
  return createFirestoreErrorHandler(entityType);
};
