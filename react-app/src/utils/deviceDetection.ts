// React import for the hook
import React from 'react';

// Device detection utilities for responsive UI
export interface DeviceInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouchDevice: boolean;
  screenSize: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export const getDeviceInfo = (): DeviceInfo => {
  const userAgent = navigator.userAgent.toLowerCase();
  const width = window.innerWidth;
  
  // Check for mobile devices
  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent) || width < 768;
  
  // Check for tablets (larger mobile devices)
  const isTablet = (/ipad|android/i.test(userAgent) && width >= 768 && width < 1024) || (width >= 768 && width < 1024);
  
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
    screenSize
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
