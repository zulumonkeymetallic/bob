// BuildInfo.tsx - Display build metadata (version, commit, build time, etc.)
import React, { useEffect, useState } from 'react';
import styles from './BuildInfo.module.css';

interface BuildMetadata {
  version: string;
  commit: string;
  buildId: string;
  timestamp: string;
  date: string;
  user: string;
}

const BuildInfo: React.FC<{ className?: string; compact?: boolean }> = ({ className, compact = false }) => {
  const [buildInfo, setBuildInfo] = useState<BuildMetadata | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Try to get from window.__BOB_BUILD__ (injected by orchestrator)
    const windowBuild = (window as any).__BOB_BUILD__;
    if (windowBuild) {
      setBuildInfo(windowBuild);
      return;
    }

    // Try to fetch from manifest endpoint
    fetch('/build-manifest.json')
      .then((res) => res.json())
      .then((data) => setBuildInfo(data))
      .catch(() => {
        // Silently fail if manifest not available
      });
  }, []);

  if (!buildInfo) {
    return null;
  }

  if (compact) {
    return (
      <div
        className={`${styles.buildInfoCompact} ${className || ''}`}
        onClick={() => setIsVisible(!isVisible)}
        title="Click to toggle build details"
      >
        <span className={styles.versionBadge}>v{buildInfo.version}</span>
        {isVisible && (
          <div className={styles.buildTooltip}>
            <div>
              <strong>Build:</strong> {buildInfo.buildId.slice(0, 8)}
            </div>
            <div>
              <strong>Commit:</strong> <code>{buildInfo.commit}</code>
            </div>
            <div>
              <strong>Time:</strong> {buildInfo.date}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`${styles.buildInfoFooter} ${className || ''}`}>
      <div className={styles.buildGrid}>
        <div className={styles.buildItem}>
          <span className={styles.label}>Version:</span>
          <span className={styles.value}>{buildInfo.version}</span>
        </div>
        <div className={styles.buildItem}>
          <span className={styles.label}>Commit:</span>
          <code className={styles.value}>{buildInfo.commit}</code>
        </div>
        <div className={styles.buildItem}>
          <span className={styles.label}>Build:</span>
          <code className={styles.value}>{buildInfo.buildId.slice(0, 8)}</code>
        </div>
        <div className={styles.buildItem}>
          <span className={styles.label}>Built:</span>
          <span className={styles.value}>{buildInfo.date}</span>
        </div>
        <div className={styles.buildItem}>
          <span className={styles.label}>User:</span>
          <span className={styles.value}>{buildInfo.user}</span>
        </div>
      </div>
    </div>
  );
};

export default BuildInfo;
