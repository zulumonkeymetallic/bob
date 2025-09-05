// Theme debugging utility for identifying theme inconsistencies
import { useThemeAwareColors } from '../hooks/useThemeAwareColors';
import { useTheme } from '../contexts/ThemeContext';

export interface ThemeDebugInfo {
  currentTheme: string;
  isDark: boolean;
  resolvedTheme: string;
  colors: any;
  backgrounds: any;
  timestamp: string;
  componentName?: string;
  elementStyles?: CSSStyleDeclaration | null;
}

// Enable/disable theme debugging globally
const THEME_DEBUG_ENABLED = true; // Set to true when debugging themes

// Theme mismatch detection
export const logThemeInteraction = (element: HTMLElement, eventType: string) => {
  if (!THEME_DEBUG_ENABLED) return;
  
  try {
    const currentTheme = document.documentElement.getAttribute('data-bs-theme') || 'light';
    const computedStyle = window.getComputedStyle(element);
    const backgroundColor = computedStyle.backgroundColor;
    const color = computedStyle.color;
    
    // Detect theme mismatches
    const isDarkTheme = currentTheme === 'dark';
    const hasLightBackground = backgroundColor === 'rgb(255, 255, 255)' || 
                               backgroundColor === 'white' ||
                               backgroundColor === 'rgba(255, 255, 255, 1)';
    const hasDarkBackground = backgroundColor === 'rgb(0, 0, 0)' || 
                              backgroundColor === 'black' ||
                              backgroundColor.includes('33, 37, 41'); // Bootstrap dark

    // Log theme inconsistencies
    if (isDarkTheme && hasLightBackground) {
      console.warn('🎨 THEME MISMATCH: Light background in dark theme', {
        element: element.tagName,
        class: element.className,
        backgroundColor,
        currentTheme,
        eventType
      });
    }
    
    if (!isDarkTheme && hasDarkBackground) {
      console.warn('🎨 THEME MISMATCH: Dark background in light theme', {
        element: element.tagName,
        class: element.className,
        backgroundColor,
        currentTheme,
        eventType
      });
    }

    // Enhanced click tracking with theme info
    if (eventType === 'click') {
      console.log('🖱️ Theme-aware click:', {
        theme: currentTheme,
        element: element.tagName,
        backgroundColor,
        textColor: color,
        classes: element.className,
        isVisible: element.offsetWidth > 0 && element.offsetHeight > 0,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    // Silent fail for theme debugging
  }
};

export const useThemeDebugger = (componentName: string = 'Unknown Component') => {
  const { theme } = useTheme();
  const { isDark, colors, backgrounds } = useThemeAwareColors();

  const logThemeInfo = (element?: HTMLElement | null, eventType: string = 'click') => {
    if (!THEME_DEBUG_ENABLED) return;
    
    const debugInfo: ThemeDebugInfo = {
      currentTheme: theme,
      isDark,
      resolvedTheme: isDark ? 'dark' : 'light',
      colors,
      backgrounds,
      timestamp: new Date().toISOString(),
      componentName,
      elementStyles: element?.style || null
    };

    if (THEME_DEBUG_ENABLED) {
      console.group(`🎨 Theme Debug [${componentName}] - ${eventType.toUpperCase()}`);
      console.log('📊 Theme State:', {
        currentTheme: theme,
        isDark,
        resolvedTheme: isDark ? 'dark' : 'light'
      });
      
      console.log('🎯 Colors:', colors);
      console.log('🔳 Backgrounds:', backgrounds);
      
      if (element) {
        console.log('🏷️ Element Info:', {
          tagName: element.tagName,
          className: element.className,
          id: element.id
        });
        
        const computedStyles = window.getComputedStyle(element);
        const backgroundColor = computedStyles.backgroundColor;
        const color = computedStyles.color;
        
        console.log('🎨 Computed Styles:', {
          backgroundColor,
          color,
          display: computedStyles.display,
          position: computedStyles.position
        });
        
        // Check for theme inconsistencies
        checkThemeInconsistencies(backgroundColor, color, isDark, element);
      }
      
      console.log('⏰ Timestamp:', debugInfo.timestamp);
      console.groupEnd();
    }

    return debugInfo;
  };

  const checkThemeInconsistencies = (
    backgroundColor: string, 
    color: string, 
    isDark: boolean, 
    element: HTMLElement
  ) => {
    if (!THEME_DEBUG_ENABLED) return;
    
    const issues: string[] = [];
    
    // Convert RGB to determine if color is light or dark
    const isBackgroundLight = isColorLight(backgroundColor);
    const isTextLight = isColorLight(color);
    
    if (isDark) {
      // In dark theme, backgrounds should be dark
      if (isBackgroundLight && backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent') {
        issues.push(`⚠️ LIGHT BACKGROUND in DARK theme: ${backgroundColor}`);
      }
      
      // In dark theme, text should be light
      if (!isTextLight && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
        issues.push(`⚠️ DARK TEXT in DARK theme: ${color}`);
      }
    } else {
      // In light theme, backgrounds should be light
      if (!isBackgroundLight && backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent') {
        issues.push(`⚠️ DARK BACKGROUND in LIGHT theme: ${backgroundColor}`);
      }
      
      // In light theme, text should be dark
      if (isTextLight && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
        issues.push(`⚠️ LIGHT TEXT in LIGHT theme: ${color}`);
      }
    }
    
    if (issues.length > 0) {
      console.group('🚨 THEME INCONSISTENCIES DETECTED');
      issues.forEach(issue => console.warn(issue));
      console.log('🔍 Element:', element);
      console.groupEnd();
    } else {
      console.log('✅ No theme inconsistencies detected');
    }
  };

  const isColorLight = (color: string): boolean => {
    // Handle transparent/empty colors
    if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') {
      return false;
    }
    
    // Convert color to RGB values
    let r = 0, g = 0, b = 0;
    
    if (color.startsWith('rgb(')) {
      const matches = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (matches) {
        r = parseInt(matches[1]);
        g = parseInt(matches[2]);
        b = parseInt(matches[3]);
      }
    } else if (color.startsWith('rgba(')) {
      const matches = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)/);
      if (matches) {
        r = parseInt(matches[1]);
        g = parseInt(matches[2]);
        b = parseInt(matches[3]);
      }
    } else if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      } else if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      }
    }
    
    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  };

  const createClickHandler = (additionalHandler?: (event: React.MouseEvent) => void) => {
    return (event: React.MouseEvent) => {
      const element = event.currentTarget as HTMLElement;
      logThemeInfo(element, 'click');
      
      if (additionalHandler) {
        additionalHandler(event);
      }
    };
  };

  const scanPageForInconsistencies = () => {
    if (!THEME_DEBUG_ENABLED) {
      console.log('🔍 Theme debug scanning disabled. Set THEME_DEBUG_ENABLED = true in themeDebugger.ts to enable.');
      return [];
    }
    
    console.group('🔍 Scanning entire page for theme inconsistencies');
    
    const allElements = document.querySelectorAll('*');
    const inconsistencies: Array<{element: Element, issues: string[]}> = [];
    
    allElements.forEach((element) => {
      const htmlElement = element as HTMLElement;
      const computedStyles = window.getComputedStyle(htmlElement);
      const backgroundColor = computedStyles.backgroundColor;
      const color = computedStyles.color;
      
      const issues: string[] = [];
      const isBackgroundLight = isColorLight(backgroundColor);
      const isTextLight = isColorLight(color);
      
      if (isDark) {
        if (isBackgroundLight && backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent') {
          issues.push(`Light background in dark theme: ${backgroundColor}`);
        }
        if (!isTextLight && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
          issues.push(`Dark text in dark theme: ${color}`);
        }
      } else {
        if (!isBackgroundLight && backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent') {
          issues.push(`Dark background in light theme: ${backgroundColor}`);
        }
        if (isTextLight && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
          issues.push(`Light text in light theme: ${color}`);
        }
      }
      
      if (issues.length > 0) {
        inconsistencies.push({ element, issues });
      }
    });
    
    if (THEME_DEBUG_ENABLED) {
      console.log(`Found ${inconsistencies.length} elements with theme inconsistencies:`);
      inconsistencies.forEach(({ element, issues }, index) => {
        console.group(`Issue ${index + 1}:`);
        console.log('Element:', element);
        console.log('Issues:', issues);
        console.groupEnd();
      });
      
      console.groupEnd();
    }
    return inconsistencies;
  };

  return {
    logThemeInfo,
    createClickHandler,
    scanPageForInconsistencies,
    debugInfo: {
      currentTheme: theme,
      isDark,
      resolvedTheme: isDark ? 'dark' : 'light',
      colors,
      backgrounds
    }
  };
};

// Global utility function to quickly debug any element
export const debugElementTheme = (element: HTMLElement, componentName: string = 'Manual Debug') => {
  const computedStyles = window.getComputedStyle(element);
  
  console.group(`🎨 Manual Theme Debug [${componentName}]`);
  console.log('Element:', element);
  console.log('Computed Styles:', {
    backgroundColor: computedStyles.backgroundColor,
    color: computedStyles.color,
    display: computedStyles.display,
    position: computedStyles.position
  });
  console.groupEnd();
};
