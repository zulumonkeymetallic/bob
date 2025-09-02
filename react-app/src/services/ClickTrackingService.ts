/**
 * Global Click Tracking Service
 * Tracks all user interactions (clicks, taps) across the entire application
 * Supports both mouse and touch events for desktop and mobile/iPad
 */

export interface ClickEvent {
  timestamp: string;
  page: string;
  component: string;
  element: string;
  coordinates: { x: number; y: number };
  eventType: 'click' | 'touch';
  device: 'desktop' | 'mobile' | 'tablet';
  targetInfo: {
    tagName: string;
    className: string;
    id: string;
    textContent: string;
    ariaLabel?: string;
    role?: string;
  };
}

class ClickTrackingService {
  private isInitialized = false;
  
  public initialize() {
    if (this.isInitialized) return;
    
    console.log('🖱️ CLICK TRACKING: Initializing global click tracking service');
    
    // Track mouse clicks (desktop)
    document.addEventListener('click', this.handleClick, true);
    
    // Track touch events (mobile/iPad)
    document.addEventListener('touchend', this.handleTouch, true);
    
    // Track page navigation
    this.trackPageNavigation();
    
    this.isInitialized = true;
    console.log('✅ CLICK TRACKING: Service initialized successfully');
  }
  
  public destroy() {
    console.log('🛑 CLICK TRACKING: Destroying click tracking service');
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('touchend', this.handleTouch, true);
    this.isInitialized = false;
  }
  
  private handleClick = (event: MouseEvent) => {
    this.logInteraction(event, 'click');
  };
  
  private handleTouch = (event: TouchEvent) => {
    this.logInteraction(event, 'touch');
  };
  
  private logInteraction(event: Event, eventType: 'click' | 'touch') {
    const target = event.target as HTMLElement;
    if (!target) return;
    
    // Get coordinates
    let coordinates = { x: 0, y: 0 };
    if (eventType === 'click') {
      const mouseEvent = event as MouseEvent;
      coordinates = { x: mouseEvent.clientX, y: mouseEvent.clientY };
    } else if (eventType === 'touch') {
      const touchEvent = event as TouchEvent;
      if (touchEvent.changedTouches.length > 0) {
        const touch = touchEvent.changedTouches[0];
        coordinates = { x: touch.clientX, y: touch.clientY };
      }
    }
    
    // Detect device type
    const device = this.detectDevice();
    
    // Get component and page info
    const componentInfo = this.getComponentInfo(target);
    const pageInfo = this.getPageInfo();
    
    // Create click event
    const clickEvent: ClickEvent = {
      timestamp: new Date().toISOString(),
      page: pageInfo.page,
      component: componentInfo.component,
      element: componentInfo.element,
      coordinates,
      eventType,
      device,
      targetInfo: {
        tagName: target.tagName.toLowerCase(),
        className: target.className || '',
        id: target.id || '',
        textContent: target.textContent?.trim().substring(0, 50) || '',
        ariaLabel: target.getAttribute('aria-label') || undefined,
        role: target.getAttribute('role') || undefined,
      }
    };
    
    // Log the interaction
    this.logClickEvent(clickEvent);
  }
  
  private getComponentInfo(target: HTMLElement): { component: string; element: string } {
    let component = 'Unknown';
    let element = target.tagName.toLowerCase();
    
    // Walk up the DOM to find component markers
    let current = target;
    while (current && current !== document.body) {
      // Check for React component class names
      if (current.className) {
        const classes = current.className.split(' ');
        
        // Look for component-specific class patterns
        for (const cls of classes) {
          if (cls.includes('ModernStoriesTable')) {
            component = 'ModernStoriesTable';
          } else if (cls.includes('ModernGoalsTable')) {
            component = 'ModernGoalsTable';
          } else if (cls.includes('StoriesManagement')) {
            component = 'StoriesManagement';
          } else if (cls.includes('GoalsManagement')) {
            component = 'GoalsManagement';
          } else if (cls.includes('SidebarLayout')) {
            component = 'SidebarLayout';
          } else if (cls.includes('Dashboard')) {
            component = 'Dashboard';
          } else if (cls.includes('Modal')) {
            component = 'Modal';
          } else if (cls.includes('nav-link')) {
            component = 'Navigation';
            element = 'nav-link';
          } else if (cls.includes('btn')) {
            element = 'button';
          } else if (cls.includes('form-control')) {
            element = 'input';
          }
        }
      }
      
      // Check for data attributes that might indicate component
      if (current.hasAttribute('data-component')) {
        component = current.getAttribute('data-component') || component;
      }
      
      current = current.parentElement;
    }
    
    // Enhanced element identification
    if (target.tagName === 'BUTTON') {
      element = `button-${target.textContent?.trim().toLowerCase().replace(/\s+/g, '-') || 'unknown'}`;
    } else if (target.tagName === 'A') {
      element = `link-${target.textContent?.trim().toLowerCase().replace(/\s+/g, '-') || 'unknown'}`;
    } else if (target.tagName === 'INPUT') {
      element = `input-${target.getAttribute('type') || 'text'}`;
    } else if (target.tagName === 'SELECT') {
      element = 'select';
    } else if (target.tagName === 'TD' || target.tagName === 'TH') {
      element = 'table-cell';
    }
    
    return { component, element };
  }
  
  private getPageInfo(): { page: string } {
    const pathname = window.location.pathname;
    let page = 'Unknown';
    
    if (pathname === '/' || pathname === '') {
      page = 'Dashboard';
    } else if (pathname.includes('/goals')) {
      page = 'Goals';
    } else if (pathname.includes('/stories')) {
      page = 'Stories';
    } else if (pathname.includes('/sprints')) {
      page = 'Sprints';
    } else if (pathname.includes('/tasks')) {
      page = 'Tasks';
    } else if (pathname.includes('/calendar')) {
      page = 'Calendar';
    } else if (pathname.includes('/settings')) {
      page = 'Settings';
    } else {
      page = pathname.replace('/', '');
    }
    
    return { page };
  }
  
  private detectDevice(): 'desktop' | 'mobile' | 'tablet' {
    const userAgent = navigator.userAgent.toLowerCase();
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    if (/ipad/.test(userAgent) || (isTouchDevice && window.innerWidth >= 768)) {
      return 'tablet';
    } else if (isTouchDevice || /mobile|android|iphone/.test(userAgent)) {
      return 'mobile';
    } else {
      return 'desktop';
    }
  }
  
  private trackPageNavigation() {
    // Track initial page load
    console.log('🌐 PAGE NAVIGATION: Initial page load');
    console.log('📍 URL:', window.location.href);
    console.log('📱 Device:', this.detectDevice());
    
    // Track history changes (React Router navigation)
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    
    window.history.pushState = function(...args) {
      originalPushState.apply(window.history, args);
      console.log('🌐 PAGE NAVIGATION: History pushState');
      console.log('📍 New URL:', window.location.href);
    };
    
    window.history.replaceState = function(...args) {
      originalReplaceState.apply(window.history, args);
      console.log('🌐 PAGE NAVIGATION: History replaceState');
      console.log('📍 New URL:', window.location.href);
    };
    
    // Track popstate (back/forward)
    window.addEventListener('popstate', () => {
      console.log('🌐 PAGE NAVIGATION: Popstate (back/forward)');
      console.log('📍 URL:', window.location.href);
    });
  }
  
  private logClickEvent(clickEvent: ClickEvent) {
    const emoji = clickEvent.eventType === 'touch' ? '👆' : '🖱️';
    const deviceEmoji = clickEvent.device === 'tablet' ? '📱' : clickEvent.device === 'mobile' ? '📱' : '🖥️';
    
    console.group(`${emoji} ${deviceEmoji} USER INTERACTION`);
    console.log('📍 Page:', clickEvent.page);
    console.log('🧩 Component:', clickEvent.component);
    console.log('🎯 Element:', clickEvent.element);
    console.log('📍 Coordinates:', clickEvent.coordinates);
    console.log('🏷️ Target:', clickEvent.targetInfo.tagName);
    console.log('📝 Text:', clickEvent.targetInfo.textContent);
    console.log('🆔 ID:', clickEvent.targetInfo.id || '(none)');
    console.log('🎨 Classes:', clickEvent.targetInfo.className || '(none)');
    if (clickEvent.targetInfo.ariaLabel) {
      console.log('♿ Aria Label:', clickEvent.targetInfo.ariaLabel);
    }
    if (clickEvent.targetInfo.role) {
      console.log('🎭 Role:', clickEvent.targetInfo.role);
    }
    console.log('⏰ Timestamp:', clickEvent.timestamp);
    console.groupEnd();
    
    // Also log a condensed version for easier scanning
    console.log(`${emoji} ${clickEvent.page} → ${clickEvent.component} → ${clickEvent.element} | "${clickEvent.targetInfo.textContent}"`);
  }
}

// Create singleton instance
export const clickTrackingService = new ClickTrackingService();
