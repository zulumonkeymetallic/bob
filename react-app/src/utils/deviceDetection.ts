// React import for the hook
import React from 'react';

// Device detection utilities for responsive UI
export interface DeviceInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouchDevice: boolean;
  screenSize: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** iPad specifically (any orientation) — used to keep the full nav menu available on
   * iPad even while it's routed to the mobile (phone-style) experience in portrait. */
  isIPad: boolean;
}

export const getDeviceInfo = (): DeviceInfo => {
  const userAgent = navigator.userAgent.toLowerCase();
  const width = window.innerWidth;
  
  // iPad: portrait (<1024px) → mobile layout; landscape (≥1024px) → tablet sidebar layout
  const isIPad = /ipad/i.test(userAgent);

  // Phone UA match (iPad excluded — handled separately by width)
  const isPhoneUA = /android|webos|iphone|ipod|blackberry|iemobile|opera mini/i.test(userAgent);

  const isMobile = (isPhoneUA && !isIPad) || width < 768 || (isIPad && width < 1024);

  // Tablet: iPad landscape, or non-iPad viewport in 768–1199px range
  const isTablet = (isIPad && width >= 1024) || (!isIPad && width >= 768 && width < 1200);

  // Desktop
  const isDesktop = !isMobile && !isTablet;
  
  // Touch device detection
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  
  // Screen size categories
  let screenSize: 'xs' | 'sm' | 'md' | 'lg' | 'xl' = 'lg';
  if (width < 576) screenSize = 'xs';
  else if (width < 768) screenSize = 'sm';
  else if (width < 992) screenSize = 'md';
  else if (width < 1200) screenSize = 'lg';
  else screenSize = 'xl';
  
  return {
    isMobile,
    isTablet,
    isDesktop,
    isTouchDevice,
    screenSize,
    isIPad
  };
};

export const useDeviceInfo = () => {
  const [deviceInfo, setDeviceInfo] = React.useState<DeviceInfo>(getDeviceInfo());
  
  React.useEffect(() => {
    const handleResize = () => {
      setDeviceInfo(getDeviceInfo());
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  return deviceInfo;
};
